import { ascii, type FormatDefinition } from './formats.ts';

// EPUB OCF requires "mimetype" as the first, stored, unadorned ZIP entry.
export const ebookFormats: readonly FormatDefinition[] = [
	{ id:'EPUB', mime:'application/epub+zip', extension:'epub', extensions:['epub'], quality:false,
		matches:b=>b.length>=58 && b[0]===80 && b[1]===75 && b[2]===3 && b[3]===4 &&
			b[8]===0 && b[9]===0 && b[26]===8 && b[27]===0 && b[28]===0 && b[29]===0 &&
			ascii(b,30,8)==='mimetype' && ascii(b,38,20)==='application/epub+zip' },
	{ id:'TXT', mime:'text/plain', extension:'txt', extensions:['txt'], quality:false, matches:()=>false }
];
