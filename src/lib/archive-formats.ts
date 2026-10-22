import { ascii, type FormatDefinition } from './formats.ts';
export const archiveFormats: readonly FormatDefinition[] = [
	{ id:'ZIP', mime:'application/zip', extension:'zip', extensions:['zip'], quality:false,
		matches:b=>b[0]===80 && b[1]===75 && ((b[2]===3 && b[3]===4) || (b[2]===5 && b[3]===6)) },
	{ id:'TAR', mime:'application/x-tar', extension:'tar', extensions:['tar'], quality:false,
		matches:b=>ascii(b,257,5)==='ustar' || (b.length>=1024 && b.every(v=>v===0)) },
	{ id:'GZIP', mime:'application/gzip', extension:'gz', extensions:['gz','tgz'], quality:false,
		matches:b=>b[0]===31 && b[1]===139 },
	{ id:'TAR.GZ', mime:'application/gzip', extension:'tar.gz', extensions:['gz','tgz'], quality:false, matches:()=>false }
];
