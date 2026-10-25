import {
	Input, BlobSource, ALL_FORMATS, Output, Conversion, NullTarget, Quality,
	Mp4OutputFormat, MovOutputFormat, WebMOutputFormat, MkvOutputFormat,
	type VideoCodec, type AudioCodec
} from 'mediabunny';
import type { EngineAdapter, ConversionRequest, StageReporter, VideoSettings } from '../engine-types.ts';
import type { EngineContext } from '../codec-registry.ts';
import { videoFormats, videoOutputs, videoCodecs } from '../video-formats.ts';
import { createVideoTarget } from '../video-output.ts';
import { STREAM_LIMIT } from '../stream-output.ts';
import { outputName } from '../results.ts';

type VideoFormat = 'MP4' | 'MOV' | 'WEBM' | 'MKV';
const defaultVideo: Record<VideoFormat, VideoCodec> = { MP4: 'avc', MOV: 'avc', WEBM: 'vp9', MKV: 'avc' };
const defaultAudio: Record<VideoFormat, AudioCodec> = { MP4: 'aac', MOV: 'aac', WEBM: 'opus', MKV: 'opus' };

function outputFormat(format: VideoFormat) {
	switch (format) {
		case 'MP4': return new Mp4OutputFormat({ fastStart: false });
		case 'MOV': return new MovOutputFormat({ fastStart: false });
		case 'WEBM': return new WebMOutputFormat();
		case 'MKV': return new MkvOutputFormat();
	}
}
function validFile(file: File, signal: AbortSignal) {
	signal.throwIfAborted();
	if (!file.size || file.size > STREAM_LIMIT) throw new Error('Video must be nonempty and no larger than 2 GiB.');
}
async function inspectTracks(input: Input) {
	const tracks = await input.getTracks();
	const videos = await input.getVideoTracks();
	const audios = await input.getAudioTracks();
	if (videos.length !== 1 || audios.length > 1 || tracks.length !== videos.length + audios.length)
		throw new Error('Phase 10 supports one video track, up to one audio track, and no subtitle/data tracks. No tracks were silently discarded.');
	const video = videos[0], width = await video.getDisplayWidth(), height = await video.getDisplayHeight();
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
		throw new Error('Video dimensions are invalid.');
	const codec = await video.getCodec();
	if (!codec) throw new Error('Unsupported or unrecognized video codec.');
	const audioCodec = audios.length ? await audios[0].getCodec() : null;
	if (audios.length && !audioCodec) throw new Error('Unsupported audio track codec.');
	const duration = await input.computeDuration();
	if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video duration is invalid.');
	return { videos, audios, codec, audioCodec, width, height, duration };
}
function chosenAudioCodec(format: VideoFormat, sourceCodec: AudioCodec | null): AudioCodec {
	// Chromium often cannot encode AAC. Keep Opus when the container supports packet-copy.
	if (sourceCodec === 'opus' && outputFormat(format).getSupportedAudioCodecs().includes('opus')) return 'opus';
	return defaultAudio[format];
}
async function canConvert(input: Input, format: VideoFormat, sourceAudio: AudioCodec | null) {
	const output = new Output({ format: outputFormat(format), target: new NullTarget() });
	const conversion = await Conversion.init({
		input, output, tracks: 'primary',
		video: { codec: defaultVideo[format] },
		...(sourceAudio ? { audio: { codec: chosenAudioCodec(format, sourceAudio) } } : {}),
		copy: { mode: 'preferred' }, showWarnings: false
	});
	try { return conversion.isValid && !conversion.discardedTracks.length && conversion.utilizedTracks.length === (sourceAudio ? 2 : 1); }
	finally { await conversion.cancel(); }
}

async function inspect(file: File, stage: StageReporter, job: EngineContext) {
	validFile(file, job.signal);
	stage('reading');
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	try {
		const source = await inspectTracks(input);
		const outputs: string[] = [];
		for (const format of videoOutputs as VideoFormat[]) {
			job.signal.throwIfAborted();
			try { if (await canConvert(input, format, source.audioCodec)) outputs.push(format); }
			catch { job.signal.throwIfAborted(); }
		}
		stage('verifying');
		const signature = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
		const identified = videoFormats.find(f => f.matches(signature));
		if (!outputs.length) throw new Error('No compatible video encoder or lossless container path is available in this browser.');
		return {
			info: {
				format: identified?.id ?? 'MP4',
				mime: identified?.mime ?? 'video/mp4',
				category: 'video' as const, width: source.width, height: source.height,
				duration: source.duration, codec: source.codec, audioCodec: source.audioCodec ?? undefined
			},
			outputs, preview: null,
			warnings: ['Video conversion preserves one video and at most one audio track. Unsupported subtitles and extra tracks are rejected.']
		};
	} finally { input.dispose(); }
}

async function convert(request: ConversionRequest, stage: StageReporter, job: EngineContext) {
	const file = request.file;
	validFile(file, job.signal);
	if (!videoOutputs.includes(request.format)) throw new Error('Unsupported video output format.');
	if (!Number.isFinite(request.quality) || request.quality < 1 || request.quality > 100)
		throw new Error('Video quality must be 1–100.');
	const format = request.format as VideoFormat;
	const settings: VideoSettings = request.video ?? { mode: 'auto', codec: 'auto' };
	if (!['auto', 'remux', 'transcode'].includes(settings.mode) ||
		!['auto', 'avc', 'vp8', 'vp9', 'hevc', 'av1'].includes(settings.codec))
		throw new Error('Invalid video settings.');
	if (settings.codec !== 'auto' && !videoCodecs[format].includes(settings.codec))
		throw new Error('The selected video codec is incompatible with this container.');
	if (settings.mode === 'remux' && settings.codec !== 'auto')
		throw new Error('Lossless remux uses the original codec; select Auto.');
	stage('reading');
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	let storage: Awaited<ReturnType<typeof createVideoTarget>> | undefined;
	let conversion: Conversion | undefined;
	try {
		const source = await inspectTracks(input);
		job.streaming?.();
		storage = await createVideoTarget(file, job);
		const output = new Output({ format: outputFormat(format), target: storage.target });
		const forced = settings.mode === 'remux';
		const codec = (settings.codec === 'auto' ? defaultVideo[format] : settings.codec) as VideoCodec;
		conversion = await Conversion.init({
			input, output, tracks: 'primary', copy: { mode: forced ? 'forced' : 'preferred' },
			video: forced ? {} : { codec, forceTranscode: settings.mode === 'transcode', quality: new Quality(request.quality / 100) },
			...(source.audios.length ? { audio: forced ? {} : { codec: chosenAudioCodec(format, source.audioCodec) } } : {}),
			showWarnings: false
		});
		if (!conversion.isValid || conversion.discardedTracks.length || conversion.utilizedTracks.length !== source.videos.length + source.audios.length)
			throw new Error(forced ? 'Lossless remux is not possible for these codecs and this container. Choose Auto or Transcode.' : 'This browser cannot encode all required video/audio tracks for the selected format.');
		stage('encoding', 0);
		conversion.onProgress = p => stage('encoding', Math.min(90, Math.floor(p * 90)));
		await conversion.execute();
		stage('verifying', 95);
		const name = outputName(file.name, format);
		const saved = await storage.finish(videoFormats.find(f => f.id === format)!.mime);
		const check = new Input({ source: new BlobSource(saved.blob), formats: ALL_FORMATS });
		try {
			const checked = await inspectTracks(check);
			if (checked.videos.length !== source.videos.length || checked.audios.length !== source.audios.length ||
				Math.abs(checked.duration - source.duration) > 0.2 ||
				checked.width !== source.width || checked.height !== source.height ||
				(settings.mode === 'transcode' && checked.codec !== codec) ||
				(settings.mode === 'auto' && checked.codec !== codec && checked.codec !== source.codec) ||
				(forced && checked.codec !== source.codec))
				throw new Error('Converted video failed codec, duration, dimension or track verification.');
		} finally { check.dispose(); }
		return {
			...saved, name, format, mime: videoFormats.find(f => f.id === format)!.mime,
			engines: { decoder: forced ? 'packet-copy' : 'Mediabunny', encoder: forced ? 'packet-copy' : 'WebCodecs' }
		};
	} catch (error) {
		await conversion?.cancel().catch(() => {});
		await storage?.abort();
		throw error;
	} finally { input.dispose(); }
}

export const videoCodec: EngineAdapter = {
	inspect(file, stage, _verified, context) {
		return inspect(file, stage, context ?? { signal: new AbortController().signal, stage });
	},
	run(request, stage, context) {
		return convert(request, stage, context ?? { signal: new AbortController().signal, stage });
	}
};
