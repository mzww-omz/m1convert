import {Input,BlobSource,ALL_FORMATS,AudioSampleSink,AudioSample,AudioSampleSource,Output,BufferTarget,Mp4OutputFormat,AdtsOutputFormat,canEncodeAudio,canDecodeAudio} from 'mediabunny';
import {audioBounds} from '../audio-validation.ts';
import type {Pcm} from './pcm.ts';
export async function nativeAacAvailable(rate=48000,channels=2,bitrate=192) {
	try{return await canEncodeAudio('aac',{sampleRate:rate,numberOfChannels:channels,bitrate:bitrate*1000})&&await canDecodeAudio('aac',{sampleRate:rate,numberOfChannels:channels});}catch{return false;}
}
export async function decodeAac(file:File):Promise<Pcm> {
	const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
	try {
		const tracks=await input.getTracks(),audio=await input.getAudioTracks();
		if(tracks.length!==1||audio.length!==1||await audio[0].getCodec()!=='aac')throw new Error('Only single-track AAC audio is supported in AAC/M4A, not video or other codecs.');
		const track=audio[0],rate=await track.getSampleRate(),channels=await track.getNumberOfChannels();audioBounds(rate,channels,0);
		if(!(await track.canDecode()))throw new Error('This browser cannot decode the actual AAC codec.');
		const duration=await track.computeDuration(),chunks:Float32Array[]=[];let total=0;
		if(Number.isFinite(duration)&&duration>0)audioBounds(rate,channels,Math.round(duration*rate)*channels);
		for await(const sample of new AudioSampleSink(track).samples()) {
			try {
				if(sample.sampleRate!==rate||sample.numberOfChannels!==channels)throw new Error('Changing AAC stream parameters are not supported.');
				const start=Math.min(sample.numberOfFrames,Math.max(0,Math.round(-sample.timestamp*rate)));
				const end=Number.isFinite(duration)?Math.min(sample.numberOfFrames,Math.round((duration-sample.timestamp)*rate)):sample.numberOfFrames;
				const count=Math.max(0,end-start);if(!count)continue;
				audioBounds(rate,channels,total+count*channels);
				const data=new Float32Array(count*channels);sample.copyTo(data,{format:'f32',planeIndex:0,frameOffset:start,frameCount:count});
				if(data.some(v=>!Number.isFinite(v)))throw new Error('Invalid decoded AAC samples.');chunks.push(data);total+=data.length;
			}finally{sample.close();}
		}
		if(!total)throw new Error('No decodable AAC samples.');
		const samples=new Float32Array(total);let p=0;for(const chunk of chunks){samples.set(chunk,p);p+=chunk.length;}return {sampleRate:rate,channels,samples};
	}finally{input.dispose();}
}
export async function encodeAac(pcm:Pcm,format:string,bitrate:number,onProgress?:(fraction:number)=>void):Promise<Uint8Array> {
	if(!(await nativeAacAvailable(pcm.sampleRate,pcm.channels,bitrate)))throw new Error(`Native AAC encoding/decoding is unavailable for ${pcm.sampleRate} Hz, ${pcm.channels} channels and ${bitrate} kbps. Try 48000 Hz, a lower bitrate, or WAV.`);
	const target=new BufferTarget(),output=new Output({format:format==='M4A'?new Mp4OutputFormat({fastStart:'in-memory'}):new AdtsOutputFormat(),target});
	const source=new AudioSampleSource({codec:'aac',bitrate:bitrate*1000});output.addAudioTrack(source);
	let complete=false;
	try {
		await output.start();const frames=pcm.samples.length/pcm.channels;
		for(let p=0;p<frames;p+=4096) {
			const end=Math.min(frames,p+4096),sample=new AudioSample({format:'f32',data:pcm.samples.slice(p*pcm.channels,end*pcm.channels),numberOfChannels:pcm.channels,sampleRate:pcm.sampleRate,timestamp:p/pcm.sampleRate});
			try{await source.add(sample);}finally{sample.close();}onProgress?.(end/frames);
		}
		source.close();await output.finalize();complete=true;
		if(!target.buffer||target.buffer.byteLength>64*1024**2)throw new Error('AAC output exceeds the size limit or is empty.');return new Uint8Array(target.buffer);
	}finally{if(!complete)await output.cancel();}
}
