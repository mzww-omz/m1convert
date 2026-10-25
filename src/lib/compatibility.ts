import { formatById } from './registry.ts';

const mimeAliases:Record<string,string[]> = {
 WAV:['audio/x-wav','audio/wave','audio/vnd.wave'], AIFF:['audio/x-aiff'], MP3:['audio/mp3'],
 FLAC:['audio/x-flac'], OGG:['application/ogg'], OPUS:['audio/ogg','application/ogg'],
 AAC:['audio/aacp','audio/x-aac'], M4A:['audio/x-m4a','video/mp4'],
 MP4:['application/mp4'], MOV:['video/mov','video/x-quicktime'], WEBM:['application/webm'], MKV:['video/mkv','application/x-matroska'],
 ICO:['image/vnd.microsoft.icon'], BMP:['image/x-ms-bmp'], GZIP:['application/x-gzip'], 'TAR.GZ':['application/x-gzip']
};
// Call only after structural validation and successful decoding, never to authorize an input.
export function compatibilityWarnings(file:File,format:string):string[] {
 const definition=formatById(format)!, warnings:string[]=[];
 const extension=file.name.includes('.')?file.name.split('.').pop()!.toLowerCase():'';
 if(extension&&!definition.extensions.includes(extension))warnings.push(`Compatibility warning: file extension differs from detected ${format}. Conversion uses the validated contents.`);
 if(file.type&&!['application/octet-stream',definition.mime,...mimeAliases[format]??[]].includes(file.type.toLowerCase()))warnings.push(`Compatibility warning: declared MIME differs from detected ${format}. Conversion uses the validated contents.`);
 return warnings;
}
