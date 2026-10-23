import { ascii, type FormatDefinition } from './formats.ts';
import type {AudioSettings} from './engine-types.ts';
export const audioFormats:readonly FormatDefinition[]=[
	{id:'WAV',mime:'audio/wav',extension:'wav',extensions:['wav','wave'],quality:false,
		matches:b=>ascii(b,0,4)==='RIFF'&&ascii(b,8,4)==='WAVE'},
	{id:'AIFF',mime:'audio/aiff',extension:'aiff',extensions:['aif','aiff'],quality:false,
		matches:b=>ascii(b,0,4)==='FORM'&&['AIFF','AIFC'].includes(ascii(b,8,4))},
	{id:'MP3',mime:'audio/mpeg',extension:'mp3',extensions:['mp3'],quality:true,
		matches:b=>ascii(b,0,3)==='ID3'||(b[0]===255&&(b[1]&0xe0)===0xe0&&(b[1]&6)===2)},
	{id:'FLAC',mime:'audio/flac',extension:'flac',extensions:['flac'],quality:false,matches:b=>ascii(b,0,4)==='fLaC'},
	{id:'OGG',mime:'audio/ogg',extension:'ogg',extensions:['ogg','oga'],quality:true,
		matches:b=>ascii(b,0,4)==='OggS'&&ascii(b,27+(b[26]||0),8)!=='OpusHead'},
	{id:'OPUS',mime:'audio/opus',extension:'opus',extensions:['opus','ogg','oga'],quality:true,
		matches:b=>ascii(b,0,4)==='OggS'&&ascii(b,27+(b[26]||0),8)==='OpusHead'},
	{id:'AAC',mime:'audio/aac',extension:'aac',extensions:['aac','adts'],quality:false,
		matches:b=>b[0]===255&&(b[1]&0xf6)===0xf0},
	{id:'M4A',mime:'audio/mp4',extension:'m4a',extensions:['m4a','mp4'],quality:false,
		matches:b=>ascii(b,4,4)==='ftyp'&&!['avif','avis'].includes(ascii(b,8,4))}
];
export function audioBitrates(format:string,rate:number):number[] {
	if(format==='MP3')return rate<32000?[8,16,24,32,40,48,56,64,80,96,112,128,144,160]:[32,40,48,56,64,80,96,112,128,160,192,224,256,320];
	if(format==='OPUS')return [6,12,24,32,48,64,96,128,160,192,256,320,510];
	return [32,48,64,96,128,160,192,256,320,...(format==='OGG'?[480,500]:[512])];
}
export function validateAudioEncoding(format:string,rate:number,bitrate:number,mode:string,duration=0) {
	if(!['bitrate','quality'].includes(mode))throw new Error('Invalid audio quality mode.');
	if(['WAV','AIFF','FLAC'].includes(format)||mode==='quality'&&['MP3','OGG'].includes(format))return;
	if(!Number.isSafeInteger(bitrate)||bitrate<1||bitrate>2147483)throw new Error('Invalid audio bitrate: use a positive kbps value representable by the encoder.');
	if(format==='MP3'&&!audioBitrates(format,rate).includes(bitrate))throw new Error('MP3 bitrate is incompatible with the sample rate. Choose a listed bitrate or use VBR quality.');
	if(format==='OPUS'&&(bitrate<6||bitrate>510))throw new Error('Opus bitrate must be 6–510 kbps. Choose a lower bitrate.');
	if(bitrate*125*duration>63*1024**2)throw new Error('Safety limit: target audio output exceeds the 64 MiB buffer budget including container overhead. Choose a lower bitrate or split the source.');
}
export const mp3Rates=[8000,11025,12000,16000,22050,24000,32000,44100,48000];
export function compatibleAudioSettings(settings:AudioSettings,format:string,sourceRate=48000):AudioSettings {
	let audio=settings;
	if(format==='OPUS') {
		if(audio.sampleRate&&audio.sampleRate!==48000)audio={...audio,sampleRate:48000};
		if(audio.bitrate!==undefined&&!audioBitrates(format,48000).includes(audio.bitrate))audio={...audio,bitrate:192};
	}
	if(format==='MP3') {
		if(audio.sampleRate&&!mp3Rates.includes(audio.sampleRate))audio={...audio,sampleRate:0};
		const rate=audio.sampleRate||sourceRate;
		if(!audioBitrates(format,rate).includes(audio.bitrate??192))audio={...audio,bitrate:rate<32000?128:192};
	}
	if(['AAC','M4A','OGG'].includes(format)&&audio.bitrate!==undefined&&!audioBitrates(format,audio.sampleRate||sourceRate).includes(audio.bitrate))audio={...audio,bitrate:192};
	return audio;
}
export const sampleRates=[8000,11025,12000,16000,22050,24000,32000,44100,48000,64000,88200,96000,192000] as const;
