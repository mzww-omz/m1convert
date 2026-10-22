import type LibAV from '@libav.js/types';
import {audioBounds} from '../audio-validation.ts';
import {quantizePcm16,type Pcm} from './pcm.ts';
let loading:Promise<LibAV.LibAV> | undefined;
export function loadAudioWasm():Promise<LibAV.LibAV> {
	if(!loading) loading=(async()=>{
		if(typeof WebAssembly==='undefined')throw new Error('WebAssembly audio codecs are unavailable.');
		const name='libav-6.10.9.0-obsolete.mjs';
		const base=typeof location==='undefined'?new URL(['..','..','..','static','vendor','libav-6.10.9.0',''].join('/'),import.meta.url).href:new URL(`${import.meta.env.BASE_URL}vendor/libav-6.10.9.0/`,location.origin).href;
		const {default:wrapper}=await import(/* @vite-ignore */ base+name) as {default:LibAV.LibAVWrapper};
		const lib=await wrapper.LibAV({base:base.replace(/\/$/,''),noworker:true,nothreads:true});
		await lib.av_log_set_level(lib.AV_LOG_ERROR);
		return lib;
	})();
	return loading;
}
function frameSamples(lib:LibAV.LibAV,frame:LibAV.Frame):Float32Array {
	const channels=lib.ff_channels(frame),rate=frame.sample_rate!,count=frame.nb_samples!;
	audioBounds(rate,channels,count*channels);
	const out=new Float32Array(count*channels),planar=frame.format>=lib.AV_SAMPLE_FMT_U8P,kind=planar?frame.format-lib.AV_SAMPLE_FMT_U8P:frame.format;
	if(kind<0||kind>4)throw new Error('Unsupported decoded audio sample representation.');
	for(let i=0;i<count;i++)for(let c=0;c<channels;c++) {
		const raw=planar?frame.data[c][i]:frame.data[i*channels+c];
		const value=kind===0?(raw-128)/128:kind===1?raw/32768:kind===2?raw/2147483648:raw;
		if(!Number.isFinite(value))throw new Error('Decoded audio contains invalid samples.');out[i*channels+c]=Math.max(-1,Math.min(1,value));
	}
	return out;
}
export async function decodeWasm(bytes:Uint8Array,expected:string):Promise<Pcm> {
	const lib=await loadAudioWasm();await lib.writeFile('input',bytes);
	let demux=0,c=0,pkt=0,frame=0;
	try {
		const [ctx,streams]=await lib.ff_init_demuxer_file('input');demux=ctx;
		if(streams.length!==1||streams[0].codec_type!==lib.AVMEDIA_TYPE_AUDIO)throw new Error('Only a single audio stream without video is supported.');
		const stream=streams[0],codec=await lib.avcodec_get_name(stream.codec_id),required:Record<string,string[]>={MP3:['mp3'],FLAC:['flac'],OGG:['vorbis'],OPUS:['opus']};
		if(!required[expected]?.includes(codec))throw new Error('The actual audio codec does not match the selected container.');
		const par=await lib.ff_copyout_codecpar(stream.codecpar);audioBounds(par.sample_rate!,par.channels!,0);
		[,c,pkt,frame]=await lib.ff_init_decoder(stream.codec_id,stream.codecpar);
		if(await lib.av_opt_set(c,'err_detect','crccheck+explode',0)<0)throw new Error('Strict audio decoder validation is unavailable.');
		const chunks:Float32Array[]=[];let total=0,rate=0,channels=0;
		for(;;) {
			const [code,packets]=await lib.ff_read_frame_multi(demux,pkt,{limit:16384});
			if(code!==0&&code!==-lib.EAGAIN&&code!==lib.AVERROR_EOF)throw new Error('Corrupt audio packet stream.');
			for(const packet of packets[stream.index]??[]) {
				if((packet.flags??0)&lib.AV_PKT_FLAG_CORRUPT)throw new Error('Corrupt audio packet.');
				const frames=await lib.ff_decode_multi(c,pkt,frame,[packet]);
				for(const f of frames)append(f);
			}
			if(code===lib.AVERROR_EOF){for(const f of await lib.ff_decode_multi(c,pkt,frame,[],true))append(f);break;}
		}
		function append(f:LibAV.Frame) {
			const ch=lib.ff_channels(f),hz=f.sample_rate!;if(rate&&(rate!==hz||channels!==ch))throw new Error('Changing audio stream parameters are not supported.');
			rate=hz;channels=ch;const count=f.nb_samples!*channels;audioBounds(rate,channels,total+count);const data=frameSamples(lib,f);chunks.push(data);total+=data.length;
		}
		if(!total)throw new Error('No decodable audio samples were found.');
		const samples=new Float32Array(total);let offset=0;for(const b of chunks){samples.set(b,offset);offset+=b.length;}
		return {sampleRate:rate,channels,samples};
	} finally {
		if(c)await lib.ff_free_decoder(c,pkt,frame);if(demux)await lib.avformat_close_input_js(demux);await lib.unlink('input');
	}
}
export async function encodeWasm(pcm:Pcm,format:string,bitrate:number,quality?:number,onProgress?:(fraction:number)=>void):Promise<Uint8Array> {
	const lib=await loadAudioWasm(),codecs:Record<string,string>={MP3:'libmp3lame',FLAC:'flac',OGG:'libvorbis',OPUS:'libopus'},codec=codecs[format];
	if(!codec)throw new Error('Unsupported audio encoder.');
	const sample_fmt=format==='FLAC'?lib.AV_SAMPLE_FMT_S16:format==='OPUS'?lib.AV_SAMPLE_FMT_FLT:lib.AV_SAMPLE_FMT_FLTP;
	const channel_layout=pcm.channels===1?4:3;
	const options:Record<string,string>=quality===undefined?{}:{flags:'+qscale',global_quality:String(Math.round((format==='MP3'?(100-quality)*9/99:quality/10)*118))};
	let c=0,frame=0,pkt=0,oc=0,pb=0;
	try {
		let size:number;[,c,frame,pkt,size]=await lib.ff_init_encoder(codec,{ctx:{sample_fmt,sample_rate:pcm.sampleRate,channels:pcm.channels,channel_layout,bit_rate:bitrate*1000},options,time_base:[1,pcm.sampleRate]});
		[oc,,pb]=await lib.ff_init_muxer({filename:'output',format_name:format==='MP3'?'mp3':format==='FLAC'?'flac':'ogg',open:true},[[c,1,pcm.sampleRate]]);
		await lib.avformat_write_header(oc,0);
		const frames=pcm.samples.length/pcm.channels;size=size||1024;
		for(let start=0;start<frames;start+=size) {
			const count=Math.min(size,frames-start);let data:Float32Array|Int16Array|Float32Array[];
			if(sample_fmt===lib.AV_SAMPLE_FMT_FLTP)data=Array.from({length:pcm.channels},(_,ch)=>Float32Array.from({length:count},(_,i)=>pcm.samples[(start+i)*pcm.channels+ch]));
			else if(sample_fmt===lib.AV_SAMPLE_FMT_S16)data=Int16Array.from(pcm.samples.subarray(start*pcm.channels,(start+count)*pcm.channels),quantizePcm16);
			else data=pcm.samples.slice(start*pcm.channels,(start+count)*pcm.channels);
			const packets=await lib.ff_encode_multi(c,frame,pkt,[{data,format:sample_fmt,sample_rate:pcm.sampleRate,channels:pcm.channels,channel_layout,nb_samples:count,pts:start}]);
			await lib.ff_write_multi(oc,pkt,packets);onProgress?.((start+count)/frames);
		}
		await lib.ff_write_multi(oc,pkt,await lib.ff_encode_multi(c,frame,pkt,[],true));await lib.av_write_trailer(oc);
		const bytes=await lib.readFile('output');if(bytes.length>64*1024**2)throw new Error('Audio output exceeds 64 MiB.');return bytes;
	} finally {if(oc)await lib.ff_free_muxer(oc,pb);if(c)await lib.ff_free_encoder(c,frame,pkt);try{await lib.unlink('output');}catch{/* Initialization may fail before output exists. */}}
}
