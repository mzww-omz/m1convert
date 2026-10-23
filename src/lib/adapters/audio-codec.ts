import type {EngineAdapter,StageReporter,ConversionRequest} from '../engine-types.ts';
import {audioFormats,mp3Rates,validateAudioEncoding} from '../audio-formats.ts';
import {inspectAudioBytes,audioBounds} from '../audio-validation.ts';
import {convertPcm,type Pcm} from './pcm.ts';
import {runCodec,EngineFallbackError,type EngineContext} from '../codec-registry.ts';
import {audioDecoders,audioEncoders} from '../engines/audio.ts';
import {outputName} from '../results.ts';
export const compressedOutputs=['MP3','FLAC','OGG','OPUS','AAC','M4A'];
let outputs:Promise<string[]>|undefined;
export async function readAudio(file:File,output=false,onDecode?:()=>void,context?:EngineContext) {
	if(!file.size)throw new Error('Audio input is empty.');
	if(file.size>64*1024**2)throw new Error('Safety limit: audio exceeds the 64 MiB buffer budget. Split the source into smaller files.');
	const job=context??{signal:new AbortController().signal,stage:()=>{}};
	job.signal.throwIfAborted();
	const bytes=new Uint8Array(await file.arrayBuffer()),header=inspectAudioBytes(file,bytes);
	onDecode?.();
	const {value:pcm,engineId}=await runCodec(audioDecoders,{file,bytes},{format:header.format},job,pcm=>{
		audioBounds(pcm.sampleRate,pcm.channels,pcm.samples.length);
		if('total' in header&&typeof header.total==='number'&&header.total&&pcm.samples.length!==header.total*pcm.channels)throw new Error('FLAC decoded sample count does not match STREAMINFO.');
	});
	return {pcm,format:header.format,engineId};
}
export function availableAudioOutputs(verified:readonly string[]=[],context?:EngineContext) {
	if(!outputs)outputs=(async()=>{
		const result=['WAV','AIFF',...compressedOutputs.filter(format=>verified.includes(format))],pcm:Pcm={sampleRate:48000,channels:2,samples:Float32Array.from({length:8192},(_,i)=>.2*Math.sin(i*.1))};
		const job:EngineContext=context??{signal:new AbortController().signal,stage:()=>{}};
		const probe=async(formats:readonly string[])=>{
			for(const format of formats.filter(format=>!result.includes(format)))try {
				await runCodec(audioEncoders,pcm,{format,quality:90,bitrate:192,mode:'bitrate',sampleRate:48000,channels:2,duration:pcm.samples.length/2/48000},job,async bytes=>{
					const def=audioFormats.find(f=>f.id===format)!,file=new File([bytes.slice()],`probe.${def.extension}`,{type:def.mime});
					const {pcm:decoded,format:actual}=await readAudio(file,true,undefined,job);
					if(actual!==format||decoded.channels!==2||decoded.sampleRate!==48000||Math.abs(decoded.samples.length-pcm.samples.length)>=48000*.1*2)throw new Error('Codec probe failed verification.');
				});
				result.push(format);
			}catch{job.signal.throwIfAborted();/* Only real, verified encoders are advertised. */}
		};
		// Libav uses one virtual filesystem per worker: do not run its probes concurrently.
		await Promise.all([probe(['MP3','FLAC','OGG','OPUS']),probe(['AAC','M4A'])]);
		return ['WAV','AIFF',...compressedOutputs].filter(format=>result.includes(format));
	})().catch(error=>{outputs=undefined;throw error;});return outputs;
}
async function single(request:ConversionRequest,stage:StageReporter,job:EngineContext) {
	job.signal.throwIfAborted();
	stage('reading');const {pcm,engineId:decoder}=await readAudio(request.file,false,()=>stage('decoding'),job);stage('decoding');
	const settings=request.audio??{sampleRate:0,channels:0},format=request.format;
	if(!['WAV','AIFF',...compressedOutputs].includes(format))throw new Error('Unsupported audio output format.');
	const bitrate=settings.bitrate??192,mode=settings.mode??'bitrate';
	if(!Number.isFinite(request.quality)||request.quality<1||request.quality>100)throw new Error('Audio quality must be 1–100.');
	let rate=settings.sampleRate||pcm.sampleRate;
	if(format==='OPUS') {if(settings.sampleRate&&settings.sampleRate!==48000)throw new Error('Ogg Opus output uses 48000 Hz.');rate=48000;}
	if(format==='MP3'&&!mp3Rates.includes(rate)) {if(settings.sampleRate)throw new Error('MP3 does not support this sample rate.');rate=48000;}
	validateAudioEncoding(format,rate,bitrate,mode,pcm.samples.length/pcm.channels/pcm.sampleRate);
	const converted=convertPcm(pcm,{...settings,sampleRate:rate===pcm.sampleRate&&!settings.sampleRate?0:rate});stage('encoding',0);
	const def=audioFormats.find(f=>f.id===format)!,name=outputName(request.file.name,format);
	let verifiedBlob:Blob|undefined;
	const {engineId:encoder,fallbackFrom}=await runCodec(audioEncoders,converted,{format,quality:request.quality,bitrate,mode,sampleRate:converted.sampleRate,channels:converted.channels,duration:converted.samples.length/converted.channels/converted.sampleRate},job,async bytes=>{
		if(bytes.length>64*1024**2)throw new Error('Safety limit: audio output exceeds 64 MiB.');
		stage('verifying',95);const candidate=new Blob([bytes.slice()],{type:def.mime});
		const {pcm:verified,format:actual}=await readAudio(new File([candidate],name,{type:def.mime}),true,undefined,{...job,stage:()=>stage('verifying',95)});
		const duration=converted.samples.length/converted.channels/converted.sampleRate,actualDuration=verified.samples.length/verified.channels/verified.sampleRate;
		if(actual!==format||verified.channels!==converted.channels||verified.sampleRate!==converted.sampleRate||Math.abs(actualDuration-duration)>(['WAV','AIFF','FLAC'].includes(format)?1/converted.sampleRate:.08))throw new EngineFallbackError('unsupported','Encoded audio codec, duration, channels or sample rate failed verification.');
		verifiedBlob=candidate;
	});
	return {blob:verifiedBlob!,name,format,mime:def.mime,engines:{decoder,encoder,fallbackFrom}};
}
export const audioCodec:EngineAdapter={
	async inspect(file,stage,verifiedOutputs,context) {
		stage('reading');const {pcm,format}=await readAudio(file,false,()=>stage('decoding'),context);stage('verifying');const def=audioFormats.find(f=>f.id===format)!;
		return {info:{format,mime:def.mime,category:'audio',sampleRate:pcm.sampleRate,channels:pcm.channels,duration:pcm.samples.length/pcm.channels/pcm.sampleRate,codec:format==='M4A'?'AAC':format==='OGG'?'Vorbis':format},outputs:await availableAudioOutputs(verifiedOutputs,context),preview:null};
	},
	async run(request,stage,context) {
		const job=context??{signal:new AbortController().signal,stage};
		if(!request.files||request.files.length<2)return single(request,stage,job);
		const files=request.files;
		if(files.length>32||files[0].name!==request.file.name||files.reduce((n,f)=>n+f.size,0)>32*1024**2)throw new Error('Audio batch exceeds 32 files or 32 MiB total.');
		const {encodeZip,decodeZip}=await import('./archive.ts');const entries=[];let total=0;
		for(let i=0;i<files.length;i++) {
			let result;
			try { result=await single({...request,file:files[i],files:undefined},s=>stage(s),job); }
			catch(error) { job.signal.throwIfAborted(); throw new Error(`Audio batch file ${i+1} (${files[i].name}): ${error instanceof Error?error.message:'conversion failed'}`); }
			const data=new Uint8Array(await result.blob.arrayBuffer());total+=data.length;
			if(total>64*1024**2)throw new Error('Audio batch exceeds the 64 MiB output limit.');
			entries.push({name:`${i+1}-${result.name}`,data,directory:false,mtime:0});stage('encoding',(i+1)/files.length*95);
		}
		stage('encoding');const bytes=await encodeZip(entries,false);stage('verifying',95);await decodeZip(bytes);
		return {blob:new Blob([bytes.slice()],{type:'application/zip'}),name:'converted-audio.zip',format:'ZIP',mime:'application/zip'};
	}
};
