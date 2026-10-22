import { ascii, type FormatDefinition } from './formats.ts';
export const audioFormats:readonly FormatDefinition[]=[
	{id:'WAV',mime:'audio/wav',extension:'wav',extensions:['wav','wave'],quality:false,
		matches:b=>ascii(b,0,4)==='RIFF'&&ascii(b,8,4)==='WAVE'},
	{id:'AIFF',mime:'audio/aiff',extension:'aiff',extensions:['aif','aiff'],quality:false,
		matches:b=>ascii(b,0,4)==='FORM'&&['AIFF','AIFC'].includes(ascii(b,8,4))}
];
export const sampleRates=[8000,16000,22050,24000,32000,44100,48000,88200,96000,192000] as const;
