import { formatsFor } from './registry.ts';
import { sampleRates, compatibleAudioSettings } from './audio-formats.ts';
import { videoCodecs } from './video-formats.ts';
import type { AudioSettings, ArchiveSettings, VideoSettings, Analysis, ConversionResult, Stage } from './engine-types.ts';
export { outputName } from './results.ts';

export type Phase = 'upload' | 'details' | 'progress' | 'complete' | 'error';
export interface State {
	phase: Phase;
	file: File | null;
	files?: File[];
	audio: AudioSettings;
	archive: ArchiveSettings;
	video: VideoSettings;
	analysis: Analysis | null;
	analysisError: string;
	format: string;
	quality: number;
	frame?: number;
	progress: number | null;
	stage: Stage;
	runId: number;
	error: string;
	result: ConversionResult | null;
}
export type Event =
	| { type: 'LOAD'; file: File; files?:File[] }
	| { type: 'ANALYZED'; runId: number; analysis: Analysis }
	| { type: 'ANALYSIS_FAILED'; runId: number; message: string }
	| { type: 'FORMAT'; format: string }
	| { type: 'QUALITY'; quality: number }
	| ({type:'AUDIO'} & Partial<AudioSettings>)
	| { type:'ARCHIVE'; compression:'store'|'deflate' }
	| ({type:'VIDEO'} & Partial<VideoSettings>)
	| { type: 'FRAME'; frame: number }
	| { type: 'START' | 'CANCEL' | 'AGAIN' | 'RESET' | 'RETRY' | 'ANALYZE' }
	| { type: 'TICK'; runId: number; progress: number | null; stage: Stage }
	| { type: 'DONE'; runId: number; result: ConversionResult }
	| { type: 'FAIL'; runId: number; message: string };

export const initialState: State = {
	phase: 'upload', file: null, analysis: null, analysisError: '', format: '', quality: 90,
	progress: null, stage: 'reading', runId: 0, error: '', result: null,
	audio:{sampleRate:0,channels:0}, archive:{compression:'deflate'}, video:{mode:'auto',codec:'auto'}
};

export function transition(state: State, event: Event): State {
	if (event.type === 'RESET') return { ...initialState, runId: state.runId + 1 };
	if (event.type === 'LOAD') return { ...initialState, phase: 'details', file: event.file, files:event.files, runId: state.runId + 1 };
	if ('runId' in event && event.runId !== state.runId) return state;
	if (event.type === 'ANALYZED' || event.type === 'ANALYSIS_FAILED') {
		if (state.phase !== 'details' || state.analysis || state.analysisError) return state;
		if (event.type === 'ANALYSIS_FAILED') return { ...state, analysisError: event.message };
		const outputs = formatsFor(event.analysis.info.format, event.analysis.outputs);
		if (!outputs.length) return { ...state, analysisError: 'No supported outputs are available in this browser.' };
		return { ...state, analysis: { ...event.analysis, outputs }, frame:event.analysis.info.frame, format: outputs.includes('WEBP') ? 'WEBP' : outputs[0] };
	}
	if ('runId' in event && state.phase !== 'progress') return state;
	switch (event.type) {
		case 'ANALYZE':
			return state.phase === 'details' && state.file ? { ...state, analysis: null, analysisError: '', format: '', runId: state.runId + 1 } : state;
		case 'FORMAT':
			return state.phase === 'details' && state.analysis?.outputs.includes(event.format) ? { ...state, format: event.format, ...(state.analysis.info.category==='audio'?{audio:compatibleAudioSettings(state.audio,event.format,state.analysis.info.sampleRate)}:{}), ...(state.analysis.info.category==='video'&&!videoCodecs[event.format]?.includes(state.video.codec)&&state.video.codec!=='auto'?{video:{...state.video,codec:'auto'}}:{}) } : state;
		case 'FRAME':
			return state.phase === 'details' && Number.isInteger(event.frame) && state.analysis?.info.frames?.[event.frame] ? { ...state, frame:event.frame } : state;
		case 'AUDIO': {
			const {type,...patch}=event, audio={...state.audio,...patch};
			return state.phase==='details' && state.analysis?.info.category==='audio' && [0,...sampleRates].includes(audio.sampleRate) && [0,1,2].includes(audio.channels)
				&& (audio.bitrate===undefined||Number.isInteger(audio.bitrate)&&audio.bitrate>=1&&audio.bitrate<=2147483) && (audio.mode===undefined||['bitrate','quality'].includes(audio.mode))
				? {...state,audio:compatibleAudioSettings(audio,state.format,state.analysis.info.sampleRate)} : state;
		}
		case 'VIDEO': {
			if(state.phase!=='details'||state.analysis?.info.category!=='video')return state;
			const {type,...patch}=event,video={...state.video,...patch};
			if(!['auto','remux','transcode'].includes(video.mode)||!['auto','avc','vp8','vp9','hevc','av1'].includes(video.codec)||video.codec!=='auto'&&!videoCodecs[state.format]?.includes(video.codec))return state;
			return {...state,video:video.mode==='remux'?{...video,codec:'auto'}:video};
		}
		case 'ARCHIVE':
			return state.phase==='details' && state.analysis?.info.category==='archive' && ['store','deflate'].includes(event.compression)
				? {...state,archive:{compression:event.compression}} : state;
		case 'QUALITY':
			return state.phase === 'details' && Number.isFinite(event.quality) ? { ...state, quality: Math.max(1, Math.min(100, event.quality)) } : state;
		case 'START':
		case 'RETRY':
			return state.file && state.analysis?.outputs.includes(state.format) && state.phase === (event.type === 'START' ? 'details' : 'error')
				? { ...state, phase: 'progress', progress: null, stage: 'reading', error: '', result: null, runId: state.runId + 1 } : state;
		case 'TICK':
			return event.progress === null || Number.isFinite(event.progress)
				? { ...state, stage: event.stage, progress: event.progress === null ? null : Math.max(state.progress ?? 0, Math.min(99, event.progress)) } : state;
		case 'DONE': return { ...state, phase: 'complete', progress: 100, result: event.result };
		case 'FAIL': return { ...state, phase: 'error', error: event.message, result: null };
		case 'CANCEL':
			return state.phase === 'progress' ? { ...state, phase: 'details', progress: null, runId: state.runId + 1 } : state;
		case 'AGAIN':
			return state.phase === 'complete' || state.phase === 'error' ? { ...state, phase: 'details', error: '', result: null } : state;
	}
}

export function formatBytes(bytes: number): string {
	if (!bytes) return '0 B';
	const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
	return `${Number((bytes / 1024 ** unit).toFixed(1))} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}
