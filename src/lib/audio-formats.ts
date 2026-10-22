import { ascii, type FormatDefinition } from './formats.ts';
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
export const sampleRates=[8000,11025,12000,16000,22050,24000,32000,44100,48000,64000,88200,96000,192000] as const;
