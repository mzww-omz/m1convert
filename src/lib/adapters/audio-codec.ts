import type {EngineAdapter,StageReporter,ConversionRequest} from '../engine-types.ts';
import {audioFormats} from '../audio-formats.ts';
import {inspectAudioBytes,audioBounds} from '../audio-validation.ts';
import {decodePcm,convertPcm,encodeWav,type Pcm} from './pcm.ts';
import {decodeWasm,encodeWasm} from './wasm-audio.ts';
import {outputName} from '../results.ts';
export const compressedOutputs=['MP3','FLAC','OGG','OPUS','AAC','M4A'];
const qualityFormats=['MP3','OGG'];
let outputs:Promise<string[]>|undefined;
export async function readAudio(file:File,output=false) {
	if(!file.size||file.size>(output?64:32)*1024**2)throw new Error('Audio input is empty or exceeds the size limit.');
	const bytes=new Uint8Array(await file.arrayBuffer()),header=inspectAudioBytes(file,bytes);let pcm:Pcm;
	if(['WAV','AIFF'].includes(header.format))pcm=decodePcm(bytes,header.format);
	else if(['AAC','M4A'].includes(header.format))pcm=await (await import('./native-aac.ts')).decodeAac(file);
	else pcm=await decodeWasm(bytes,header.format);
	audioBounds(pcm.sampleRate,pcm.channels,pcm.samples.length);
	if('total' in header&&typeof header.total==='number'&&header.total&&pcm.samples.length!==header.total*pcm.channels)throw new Error('FLAC decoded sample count does not match STREAMINFO.');
	return {pcm,format:header.format};
}
export function availableAudioOutputs() {
	if(!outputs)outputs=(async()=>{
		const result=['WAV'],pcm:Pcm={sampleRate:48000,channels:2,samples:Float32Array.from({length:8192},(_,i)=>.2*Math.sin(i*.1))};
		for(const format of ['MP3','FLAC','OGG','OPUS'])try {
			const bytes=await encodeWasm(pcm,format,192),def=audioFormats.find(f=>f.id===format)!;
			inspectAudioBytes(new File([bytes.slice()],`probe.${def.extension}`,{type:def.mime}),bytes);
			const decoded=await decodeWasm(bytes,format);
			if(decoded.channels===2&&decoded.sampleRate===48000&&Math.abs(decoded.samples.length-pcm.samples.length)<48000*.1*2)result.push(format);
		}catch{/* Only actual encoders whose output decodes correctly are advertised. */}
		try {
			const {nativeAacAvailable,encodeAac,decodeAac}=await import('./native-aac.ts');
			if(await nativeAacAvailable())for(const format of ['AAC','M4A'])try {
				const bytes=await encodeAac(pcm,format,192),def=audioFormats.find(f=>f.id===format)!,file=new File([bytes.slice()],`probe.${def.extension}`,{type:def.mime});
				inspectAudioBytes(file,bytes);const decoded=await decodeAac(file);
				if(decoded.sampleRate===48000&&decoded.channels===2&&Math.abs(decoded.samples.length-pcm.samples.length)<48000*.1*2)result.push(format);
			}catch{/* Native codec support includes genuine mux/decode verification. */}
		}catch{/* Native AAC is optional; WASM and PCM paths remain available. */}
		return result;
	})();return outputs;
}
async function single(request:ConversionRequest,stage:StageReporter) {
	stage('reading');const {pcm}=await readAudio(request.file);stage('decoding');
	const settings=request.audio??{sampleRate:0,channels:0},format=request.format;
	if(!['WAV',...compressedOutputs].includes(format))throw new Error('Unsupported audio output format.');
	const bitrate=settings.bitrate??192,mode=settings.mode??'bitrate';
	if(!Number.isInteger(bitrate)||bitrate<6||bitrate>510||!['bitrate','quality'].includes(mode))throw new Error('Invalid audio bitrate or quality mode.');
	if(!Number.isFinite(request.quality)||request.quality<1||request.quality>100)throw new Error('Audio quality must be 1–100.');
	const mp3Rates=[8000,11025,12000,16000,22050,24000,32000,44100,48000];
	let rate=settings.sampleRate||pcm.sampleRate;
	if(format==='OPUS') {if(settings.sampleRate&&settings.sampleRate!==48000)throw new Error('Ogg Opus output uses 48000 Hz.');rate=48000;}
	if(format==='MP3'&&!mp3Rates.includes(rate)) {if(settings.sampleRate)throw new Error('MP3 does not support this sample rate.');rate=48000;}
	if(format==='MP3'&&mode==='bitrate'&&(bitrate<8||bitrate>320||(rate<32000&&bitrate>160)))throw new Error('MP3 bitrate is incompatible with the sample rate.');
	const converted=convertPcm(pcm,{...settings,sampleRate:rate});stage('encoding',0);let bytes:Uint8Array;
	if(format==='WAV')bytes=encodeWav(converted);
	else if(['AAC','M4A'].includes(format))bytes=await (await import('./native-aac.ts')).encodeAac(converted,format,bitrate,p=>stage('encoding',Math.min(95,p*95)));
	else bytes=await encodeWasm(converted,format,bitrate,mode==='quality'&&qualityFormats.includes(format)?request.quality:undefined,p=>stage('encoding',Math.min(95,p*95)));
	if(bytes.length>64*1024**2)throw new Error('Audio output exceeds 64 MiB.');
	stage('verifying',95);const def=audioFormats.find(f=>f.id===format)!,name=outputName(request.file.name,format),blob=new Blob([bytes.slice()],{type:def.mime});
	const {pcm:verified,format:actual}=await readAudio(new File([blob],name,{type:def.mime}),true);
	const duration=converted.samples.length/converted.channels/converted.sampleRate,actualDuration=verified.samples.length/verified.channels/verified.sampleRate;
	if(actual!==format||verified.channels!==converted.channels||verified.sampleRate!==converted.sampleRate||Math.abs(actualDuration-duration)>(['WAV','FLAC'].includes(format)?1/converted.sampleRate:.08))throw new Error('Encoded audio codec, duration, channels or sample rate failed verification.');
	return {blob,name,format,mime:def.mime};
}
export const audioCodec:EngineAdapter={
	async inspect(file,stage) {
		stage('reading');const {pcm,format}=await readAudio(file);stage('verifying');const def=audioFormats.find(f=>f.id===format)!;
		return {info:{format,mime:def.mime,category:'audio',sampleRate:pcm.sampleRate,channels:pcm.channels,duration:pcm.samples.length/pcm.channels/pcm.sampleRate,codec:format==='M4A'?'AAC':format==='OGG'?'Vorbis':format},outputs:await availableAudioOutputs(),preview:null};
	},
	async run(request,stage) {
		if(!request.files||request.files.length<2)return single(request,stage);
		const files=request.files;
		if(files.length>32||files[0].name!==request.file.name||files.reduce((n,f)=>n+f.size,0)>32*1024**2)throw new Error('Audio batch exceeds 32 files or 32 MiB total.');
		const {encodeZip,decodeZip}=await import('./archive.ts');const entries=[];let total=0;
		for(let i=0;i<files.length;i++) {
			const result=await single({...request,file:files[i],files:undefined},s=>stage(s)),data=new Uint8Array(await result.blob.arrayBuffer());total+=data.length;
			if(total>64*1024**2)throw new Error('Audio batch exceeds the 64 MiB output limit.');
			entries.push({name:`${i+1}-${result.name}`,data,directory:false,mtime:0});stage('encoding',(i+1)/files.length*95);
		}
		stage('encoding');const bytes=await encodeZip(entries,false);stage('verifying',95);await decodeZip(bytes);
		return {blob:new Blob([bytes.slice()],{type:'application/zip'}),name:'converted-audio.zip',format:'ZIP',mime:'application/zip'};
	}
};
