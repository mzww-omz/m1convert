import { ascii, type FormatDefinition } from './formats.ts';
export const archiveFormats: readonly FormatDefinition[] = [
	{ id:'ZIP', mime:'application/zip', extension:'zip', extensions:['zip'], quality:false,
		matches:b=>b[0]===80 && b[1]===75 && ((b[2]===3 && b[3]===4) || (b[2]===5 && b[3]===6)) },
	{ id:'TAR', mime:'application/x-tar', extension:'tar', extensions:['tar'], quality:false,
		matches:b=>ascii(b,257,5)==='ustar' || (b.length>=1024 && b.every(v=>v===0)) },
	{ id:'GZIP', mime:'application/gzip', extension:'gz', extensions:['gz','tgz'], quality:false,
		matches:b=>b[0]===31 && b[1]===139 },
	{ id:'TAR.GZ', mime:'application/gzip', extension:'tar.gz', extensions:['gz','tgz'], quality:false, matches:()=>false },
	{ id:'7Z', mime:'application/x-7z-compressed', extension:'7z', extensions:['7z'], quality:false,
		matches:b=>[0x37,0x7a,0xbc,0xaf,0x27,0x1c].every((v,i)=>b[i]===v) },
	{ id:'RAR', mime:'application/vnd.rar', extension:'rar', extensions:['rar'], quality:false,
		matches:b=>[0x52,0x61,0x72,0x21,0x1a,0x07].every((v,i)=>b[i]===v)&&((b[6]===0)||(b[6]===1&&b[7]===0)) },
	{ id:'XZ', mime:'application/x-xz', extension:'xz', extensions:['xz','txz'], quality:false,
		matches:b=>[0xfd,0x37,0x7a,0x58,0x5a,0].every((v,i)=>b[i]===v) },
	{ id:'BZ2', mime:'application/x-bzip2', extension:'bz2', extensions:['bz2','tbz2'], quality:false,
		matches:b=>b[0]===0x42&&b[1]===0x5a&&b[2]===0x68&&b[3]>=0x31&&b[3]<=0x39 },
	{ id:'ZSTD', mime:'application/zstd', extension:'zst', extensions:['zst','tzst'], quality:false,
		matches:b=>[0x28,0xb5,0x2f,0xfd].every((v,i)=>b[i]===v) }
];
