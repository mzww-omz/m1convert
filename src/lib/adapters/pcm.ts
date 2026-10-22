import { ascii } from '../formats.ts';
import { audioFormats, sampleRates } from '../audio-formats.ts';
import type { AudioSettings, EngineAdapter } from '../engine-types.ts';
import { outputName } from '../results.ts';
const MAX_SAMPLES=8_000_000, MAX_BYTES=32*1024**2;
export interface Pcm { sampleRate:number; channels:number; samples:Float32Array }
function fail(message:string):never { throw new Error(message); }
function bounds(rate:number,channels:number,frames:number) {
	if(!Number.isInteger(rate)||rate<8000||rate>192000) fail('Audio sample rate must be between 8000 and 192000 Hz.');
	if(![1,2].includes(channels)) fail('Only mono and stereo audio channels are supported.');
	if(!Number.isInteger(frames)||frames<1||frames*channels>MAX_SAMPLES) fail('Audio exceeds the 8 million decoded samples limit or has no samples.');
}
export function decodePcm(b:Uint8Array,format:string):Pcm {
	const v=new DataView(b.buffer,b.byteOffset,b.length), little=format==='WAV';
	if(b.length<12 || b.length>64*1024**2 || v.getUint32(4,little)+8!==b.length) fail('Corrupt or truncated audio container.');
	if(little ? ascii(b,0,4)!=='RIFF'||ascii(b,8,4)!=='WAVE' : ascii(b,0,4)!=='FORM'||ascii(b,8,4)!=='AIFF') fail('Only PCM WAV and uncompressed AIFF audio are supported.');
	let rate=0,channels=0,bits=0,data:Uint8Array|undefined,frames=0,encoding=1,hasFormat=false;
	for(let p=12;p<b.length;) {
		if(p+8>b.length) fail('Truncated audio chunk.');
		const type=ascii(b,p,4),size=v.getUint32(p+4,little),start=p+8,end=start+size;
		if(end+(size%2)>b.length) fail('Truncated audio chunk data.');
		if(type===(little?'fmt ':'COMM')) {
			if(hasFormat || size<(little?16:18)) fail('Invalid or duplicate audio format chunk.'); hasFormat=true;
			if(little) {
				encoding=v.getUint16(start,true); channels=v.getUint16(start+2,true); rate=v.getUint32(start+4,true); bits=v.getUint16(start+14,true);
				if(encoding===0xfffe) {
					const tail=[0,0,16,0,128,0,0,170,0,56,155,113];
					if(size!==40 || v.getUint16(start+16,true)!==22 || v.getUint16(start+18,true)!==bits || ![0,channels===1?4:3].includes(v.getUint32(start+20,true)) || !tail.every((n,i)=>b[start+28+i]===n)) fail('Unsupported extensible WAV layout or subtype.');
					encoding=v.getUint32(start+24,true);
				} else if(size!==16&&(size!==18||v.getUint16(start+16,true)!==0)) fail('Unsupported WAV format chunk.');
				if((encoding!==1&&encoding!==3) || (encoding===3&&bits!==32)) fail('Only PCM integer or float32 WAV is supported.');
				if(v.getUint16(start+12,true)!==channels*(bits/8)||v.getUint32(start+8,true)!==rate*channels*(bits/8)) fail('Invalid WAV block alignment or byte rate.');
			} else {
				if(size!==18) fail('Unsupported AIFF format chunk.');
				channels=v.getUint16(start); frames=v.getUint32(start+2); bits=v.getUint16(start+6);
				const exponent=v.getUint16(start+8), high=v.getUint32(start+10), low=v.getUint32(start+14);
				if(exponent&0x8000 || exponent===0x7fff || !(high&0x80000000)) fail('Invalid AIFF sample rate.');
				rate=(high*2**32+low)*2**(exponent-16383-63);
			}
			if(![8,16,24,32].includes(bits)) fail('Only 8/16/24/32-bit PCM audio is supported.');
		} else if(type===(little?'data':'SSND')) {
			if(data) fail('Duplicate audio data chunk.');
			if(little) data=b.subarray(start,end);
			else {
				if(size<8 || v.getUint32(start+4)!==0) fail('Unsupported AIFF sound block.');
				const offset=v.getUint32(start); if(offset>size-8) fail('Invalid AIFF sound offset.'); data=b.subarray(start+8+offset,end);
			}
		}
		p=end+(size%2);
	}
	if(!hasFormat||!data) fail('Audio format or sample data is missing.');
	const frameBytes=channels*bits/8;
	if(!frameBytes||data.length%frameBytes) fail('Audio sample data is not frame aligned.');
	const actualFrames=data.length/frameBytes;
	if(!little&&frames!==actualFrames) fail('AIFF frame count mismatch.');
	bounds(rate,channels,actualFrames);
	const samples=new Float32Array(actualFrames*channels), d=new DataView(data.buffer,data.byteOffset,data.length), step=bits/8;
	for(let i=0,p=0;i<samples.length;i++,p+=step) {
		let value:number;
		if(encoding===3) value=d.getFloat32(p,true);
		else if(bits===8) value=little?(d.getUint8(p)-128)/128:d.getInt8(p)/128;
		else if(bits===16) value=d.getInt16(p,little)/32768;
		else if(bits===24) { const n=little?data[p]|data[p+1]<<8|data[p+2]<<16:data[p]<<16|data[p+1]<<8|data[p+2]; value=(n<<8>>8)/8388608; }
		else value=d.getInt32(p,little)/2147483648;
		if(!Number.isFinite(value)) fail('Audio contains invalid nonfinite samples.');
		samples[i]=Math.max(-1,Math.min(1,value));
	}
	return {sampleRate:rate,channels,samples};
}
export function convertPcm(pcm:Pcm,settings:AudioSettings):Pcm {
	if(![0,1,2].includes(settings.channels)) fail('Unsupported output channel count.');
	const rate=settings.sampleRate||pcm.sampleRate, channels=settings.channels||pcm.channels;
	if(settings.sampleRate!==0&&!sampleRates.some(r=>r===settings.sampleRate)) fail('Unsupported output sample rate.');
	const frames=pcm.samples.length/pcm.channels, count=Math.max(1,Math.round(frames*rate/pcm.sampleRate)); bounds(rate,channels,count);
	if(rate===pcm.sampleRate&&channels===pcm.channels) return pcm;
	const out=new Float32Array(count*channels);
	const sample=(frame:number,c:number)=> {
		frame=Math.max(0,Math.min(frames-1,frame));
		if(channels===1&&pcm.channels===2) return (pcm.samples[frame*2]+pcm.samples[frame*2+1])/2;
		return pcm.samples[frame*pcm.channels+(pcm.channels===1?0:c)];
	};
	// Fixed 64-tap windowed sinc with low-pass filtering; this is not an archival mastering resampler.
	const cutoff=.94*Math.min(1,rate/pcm.sampleRate);
	for(let i=0;i<count;i++) {
		if(rate===pcm.sampleRate) { for(let c=0;c<channels;c++) out[i*channels+c]=sample(i,c); continue; }
		const pos=i*pcm.sampleRate/rate, center=Math.floor(pos); let weight=0,left=0,right=0;
		for(let k=center-31;k<=center+32;k++) {
			const x=k-pos, a=Math.PI*x*cutoff, sinc=Math.abs(a)<1e-12?1:Math.sin(a)/a;
			const window=.42+.5*Math.cos(Math.PI*x/32)+.08*Math.cos(2*Math.PI*x/32), w=cutoff*sinc*window;
			weight+=w; left+=sample(k,0)*w; if(channels===2) right+=sample(k,1)*w;
		}
		out[i*channels]=left/weight; if(channels===2) out[i*channels+1]=right/weight;
	}
	return {sampleRate:rate,channels,samples:out};
}
export function quantizePcm16(value:number):number {
	if(!Number.isFinite(value))fail('Invalid audio sample.');
	return Math.max(-32768,Math.min(32767,Math.round(value*32768)));
}
export function encodeWav(pcm:Pcm):Uint8Array {
	bounds(pcm.sampleRate,pcm.channels,pcm.samples.length/pcm.channels);
	const b=new Uint8Array(44+pcm.samples.length*2),v=new DataView(b.buffer);
	const str=(p:number,s:string)=>b.set(new TextEncoder().encode(s),p);
	str(0,'RIFF'); v.setUint32(4,b.length-8,true); str(8,'WAVE'); str(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,pcm.channels,true);
	v.setUint32(24,pcm.sampleRate,true); v.setUint32(28,pcm.sampleRate*pcm.channels*2,true); v.setUint16(32,pcm.channels*2,true); v.setUint16(34,16,true); str(36,'data'); v.setUint32(40,pcm.samples.length*2,true);
	for(let i=0;i<pcm.samples.length;i++) v.setInt16(44+i*2,quantizePcm16(pcm.samples[i]),true);
	return b;
}
async function read(file:File) {
	if(!file.size||file.size>MAX_BYTES) fail('Audio input is empty or exceeds the 32 MiB limit.');
	const b=new Uint8Array(await file.arrayBuffer()),format=audioFormats.find(f=>['WAV','AIFF'].includes(f.id)&&f.matches(b)); if(!format) fail('Unsupported audio contents.');
	const ext=file.name.includes('.')?file.name.split('.').pop()!.toLowerCase():'';
	if(ext&&!format.extensions.includes(ext)) fail('Audio extension does not match its contents.');
	const aliases=format.id==='WAV'?['audio/x-wav','audio/wave','audio/vnd.wave']:['audio/x-aiff'];
	if(file.type&&!['application/octet-stream',format.mime,...aliases].includes(file.type)) fail('Audio MIME does not match its contents.');
	return {pcm:decodePcm(b,format.id),format};
}
export const pcmCodec:EngineAdapter={
	async inspect(file,stage,verifiedOutputs) {
		stage('reading'); const {pcm,format}=await read(file); stage('verifying');
		const {availableAudioOutputs}=await import('./audio-codec.ts');
		return {info:{format:format.id,mime:format.mime,category:'audio',sampleRate:pcm.sampleRate,channels:pcm.channels,duration:pcm.samples.length/pcm.channels/pcm.sampleRate},outputs:await availableAudioOutputs(verifiedOutputs),preview:null};
	},
	async run(request,stage) {
		if(request.format!=='WAV') fail('This audio output format is not supported.');
		if(request.files && request.files.length>1) return (await import('./audio-codec.ts')).audioCodec.run(request,stage);
		stage('reading'); const {pcm}=await read(request.file); stage('decoding');
		const converted=convertPcm(pcm,request.audio??{sampleRate:0,channels:0}); stage('encoding');
		const bytes=encodeWav(converted); stage('verifying'); const verified=decodePcm(bytes,'WAV');
		if(verified.sampleRate!==converted.sampleRate||verified.channels!==converted.channels||verified.samples.length!==converted.samples.length) fail('Audio output verification failed.');
		return {blob:new Blob([bytes.slice()],{type:'audio/wav'}),name:outputName(request.file.name,'WAV'),format:'WAV',mime:'audio/wav'};
	}
};
