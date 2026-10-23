import type {CodecEngine} from '../codec-registry.ts';
import type {Pcm} from '../adapters/pcm.ts';
import {validateAudioEncoding,mp3Rates} from '../audio-formats.ts';
import {audioBounds} from '../audio-validation.ts';
export interface AudioDecodeOptions { format:string }
export interface AudioDecodeInput { file:File; bytes:Uint8Array }
export interface AudioEncodeOptions {
	format:string; quality:number; bitrate:number; mode:'bitrate'|'quality';
	sampleRate:number; channels:number; duration:number;
}
const limits=['8 million interleaved PCM samples','Mono/stereo only','64 MiB input/output','Container validation before decoding; output re-decoded'];
const wasmFormats=['MP3','FLAC','OGG','OPUS'];
function optionReason(q:AudioEncodeOptions):string|undefined {
	if(!Number.isFinite(q.quality)||q.quality<1||q.quality>100)return 'Audio quality must be 1–100.';
	if(!Number.isFinite(q.duration)||q.duration<0)return 'Invalid audio duration.';
	try {audioBounds(q.sampleRate,q.channels,Math.round(q.duration*q.sampleRate)*q.channels);validateAudioEncoding(q.format,q.sampleRate,q.bitrate,q.mode,q.duration);}
	catch(error){return (error as Error).message;}
	if(q.format==='MP3'&&!mp3Rates.includes(q.sampleRate))return 'MP3 does not support this sample rate.';
	if(q.format==='OPUS'&&q.sampleRate!==48000)return 'Ogg Opus output uses 48000 Hz.';
	if(q.format==='WAV'&&q.sampleRate*q.channels*2>0xffffffff)return 'WAV byte rate exceeds the 32-bit format capacity.';
}
export const audioDecoders:readonly CodecEngine<AudioDecodeInput,Pcm,AudioDecodeOptions>[]=[{
	capability:{id:'builtin-pcm-decode',kind:'builtin',operation:'decode',formats:['WAV','AIFF'],quality:{WAV:'not-applicable',AIFF:'not-applicable'},containers:['PCM WAV','uncompressed AIFF'],requirements:[],limits},
	load:async()=>{const {decodePcm}=await import('../adapters/pcm.ts');return {run:async(input,q)=>decodePcm(input.bytes,q.format)};}
},{
	capability:{id:'webcodecs-aac-decode',kind:'webcodecs',operation:'decode',formats:['AAC','M4A'],quality:{AAC:'not-applicable',M4A:'not-applicable'},containers:['ADTS','single-track MP4 AAC-LC'],requirements:['audioDecoder'],limits:[...limits,'Actual AAC codec/profile is checked by the decoder']},
	load:async()=>{const {decodeAac}=await import('../adapters/native-aac.ts');return {run:input=>decodeAac(input.file)};}
},{
	capability:{id:'wasm-libav-decode',kind:'wasm',operation:'decode',formats:wasmFormats,quality:Object.fromEntries(wasmFormats.map(f=>[f,'not-applicable'])),containers:['MP3','FLAC','Ogg Vorbis','Ogg Opus'],requirements:['wasm'],limits:[...limits,'Single-thread baseline; no SIMD/shared memory requirement','Strict CRC/explode decoding; one stream only']},
	load:async()=>{const {decodeWasm}=await import('../adapters/wasm-audio.ts');return {run:(input,q)=>decodeWasm(input.bytes,q.format)};}
}];
export const audioEncoders:readonly CodecEngine<Pcm,Uint8Array,AudioEncodeOptions>[]=[{
	capability:{id:'builtin-pcm-encode',kind:'builtin',operation:'encode',formats:['WAV'],quality:{WAV:'lossless'},containers:['PCM16 WAV'],requirements:[],limits:[...limits,'PCM16 quantization; WAV 32-bit byte rate capacity']},
	supports:optionReason,
	load:async()=>{const {encodeWav}=await import('../adapters/pcm.ts');return {run:async pcm=>encodeWav(pcm)};}
},{
	capability:{id:'webcodecs-aac-encode',kind:'webcodecs',operation:'encode',formats:['AAC','M4A'],quality:{AAC:'bitrate',M4A:'bitrate'},containers:['ADTS','MP4 AAC-LC'],requirements:['audioEncoder','audioDecoder'],limits:[...limits,'Exact rate/channels/bitrate queried at runtime; target bitrate may use VBR']},
	supports:async q=>{
		const invalid=optionReason(q);if(invalid)return invalid;
		const {nativeAacAvailable}=await import('../adapters/native-aac.ts');
		return await nativeAacAvailable(q.sampleRate,q.channels,q.bitrate)?undefined:'Native AAC does not support these rate/channel/bitrate settings. Try 48000 Hz, a lower bitrate, or WAV.';
	},
	load:async()=>{const {encodeAac}=await import('../adapters/native-aac.ts');return {run:(pcm,q,job)=>encodeAac(pcm,q.format,q.bitrate,p=>job.stage('encoding',Math.min(95,p*95)))};}
},{
	capability:{id:'wasm-libav-encode',kind:'wasm',operation:'encode',formats:wasmFormats,quality:{MP3:'bitrate-or-quality',FLAC:'lossless',OGG:'bitrate-or-quality',OPUS:'bitrate'},containers:['MP3','FLAC PCM16','Ogg Vorbis','Ogg Opus'],requirements:['wasm'],limits:[...limits,'MP3 rate-specific legal bitrates; Opus 48000 Hz / 6–510 kbps','Vorbis configuration checked by actual encoder','Single-thread baseline; no SIMD/shared memory requirement']},
	supports:optionReason,
	load:async()=>{const {encodeWasm}=await import('../adapters/wasm-audio.ts');return {run:(pcm,q,job)=>encodeWasm(pcm,q.format,q.bitrate,q.mode==='quality'&&['MP3','OGG'].includes(q.format)?q.quality:undefined,p=>job.stage('encoding',Math.min(95,p*95)))};}
}];
