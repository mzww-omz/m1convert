import type { EngineAdapter } from '../engine-types.ts';
import { archiveFormats } from '../archive-formats.ts';
import { ascii } from '../formats.ts';
import { outputName } from '../results.ts';

const MAX = 64 * 1024 ** 2, INPUT = 32 * 1024 ** 2, COUNT = 1000, RATIO = 200;
const utf8 = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
export interface Entry { name:string; data:Uint8Array; directory:boolean; mtime:number }
function fail(message:string):never { throw new Error(message); }
function view(b:Uint8Array) { return new DataView(b.buffer,b.byteOffset,b.length); }
function path(name:string, directory:boolean) {
	const parts=name.replace(/\/$/,'').split('/');
	if (!name || name.length>240 || name.includes('\\') || /[\x00-\x1f\x7f:]/.test(name) || name.startsWith('/') || (!directory && name.endsWith('/')) ||
		parts.some(p=>!p || p==='.' || p==='..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || utf8.encode(name).length>255)
		fail('Unsafe archive path or filename.');
}
export function validateEntries(entries:readonly Entry[]) {
	if (entries.length>COUNT) fail('Archive exceeds the 1000 entries limit.');
	let total=0; const names=new Map<string,boolean>();
	for (const e of entries) {
		path(e.name,e.directory);
		if (e.directory && e.data.length) fail('Directory entries cannot contain file data.');
		const key=e.name.replace(/\/$/,'').normalize('NFC').toLowerCase();
		if (names.has(key)) fail('Duplicate archive path or filename collision.');
		names.set(key,e.directory); total+=e.data.length;
		if (total>MAX) fail('Archive expansion exceeds the 64 MiB limit.');
	}
	for (const key of names.keys()) {
		const parts=key.split('/'); parts.pop();
		while(parts.length) { if(names.get(parts.join('/'))===false) fail('Archive file/directory path collision.'); parts.pop(); }
	}
}
// Read streams incrementally: never materialize an unbounded decompression result.
export async function transform(bytes:Uint8Array, format:'gzip'|'deflate-raw', decompress:boolean, limit=MAX):Promise<Uint8Array> {
	let stream:ReadableStream<Uint8Array>;
	try { stream=new Blob([bytes.slice()]).stream().pipeThrough(decompress ? new DecompressionStream(format) : new CompressionStream(format)); }
	catch { return fail(`This browser does not support ${format} ${decompress?'decompression':'compression'}.`); }
	const reader=stream.getReader(), chunks:Uint8Array[]=[]; let size=0;
	try {
		for (;;) {
			const {done,value}=await reader.read(); if(done) break;
			size+=value.length;
			if(size>limit) { await reader.cancel(); fail('Archive expansion/output exceeds the size limit.'); }
			chunks.push(value);
		}
	} catch(error) { if(error instanceof Error && /limit/.test(error.message)) throw error; fail('Corrupt archive: decompression failed.'); }
	finally { reader.releaseLock(); }
	const out=new Uint8Array(size); let p=0; for(const chunk of chunks) { out.set(chunk,p); p+=chunk.length; } return out;
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{ for(let k=0;k<8;k++) n=(n&1)?0xedb88320^(n>>>1):n>>>1; return n>>>0; });
export function crc32(b:Uint8Array) { let n=0xffffffff; for(const v of b) n=crcTable[(n^v)&255]^(n>>>8); return (n^0xffffffff)>>>0; }
function tarString(b:Uint8Array,p:number,n:number) {
	const part=b.subarray(p,p+n), end=part.indexOf(0);
	if(end>=0 && part.subarray(end).some(v=>v!==0)) fail('Corrupt TAR string.');
	return decoder.decode(end<0?part:part.subarray(0,end));
}
function octal(b:Uint8Array,p:number,n:number) {
	const s=ascii(b,p,n).replace(/[\0 ]+$/,'').replace(/^ +/,'');
	if(!/^[0-7]*$/.test(s)) fail('Unsupported or corrupt TAR numeric field.');
	const value=parseInt(s||'0',8); if(!Number.isSafeInteger(value)) fail('Invalid TAR size.'); return value;
}
export function decodeTar(b:Uint8Array):Entry[] {
	if(b.length<1024 || b.length%512) fail('Corrupt or truncated TAR.');
	const entries:Entry[]=[]; let p=0, total=0;
	while(p+512<=b.length) {
		const h=b.subarray(p,p+512);
		if(h.every(v=>v===0)) {
			if(p+1024>b.length || b.subarray(p).some(v=>v!==0)) fail('Corrupt TAR end marker.');
			validateEntries(entries); return entries;
		}
		if(entries.length>=COUNT) fail('Archive exceeds the 1000 entries limit.');
		let sum=0; for(let i=0;i<512;i++) sum+=i>=148&&i<156?32:h[i];
		if(sum!==octal(h,148,8)) fail('Invalid TAR header checksum.');
		if(ascii(h,257,6)!=='ustar\0' || ascii(h,263,2)!=='00') fail('Only POSIX USTAR TAR is supported.');
		const type=h[156], directory=type===53;
		if(type!==0 && type!==48 && !directory) fail('Unsupported TAR entry type: links, devices and extensions are not allowed.');
		if(tarString(h,157,100)) fail('TAR links are not allowed.');
		const prefix=tarString(h,345,155), name=(prefix?prefix+'/':'')+tarString(h,0,100), size=octal(h,124,12);
		path(name,directory); total+=size;
		if(total>MAX || (directory&&size)) fail('Archive expansion exceeds the size limit or directory has data.');
		const end=p+512+size, next=p+512+Math.ceil(size/512)*512;
		if(next>b.length || b.subarray(end,next).some(v=>v!==0)) fail('Corrupt or truncated TAR data.');
		entries.push({name,data:b.subarray(p+512,end),directory,mtime:octal(h,136,12)}); p=next;
	}
	return fail('Truncated TAR end marker.');
}
export function encodeTar(entries:readonly Entry[]):Uint8Array {
	validateEntries(entries);
	const size=1024+entries.reduce((n,e)=>n+512+Math.ceil(e.data.length/512)*512,0);
	if(size>MAX) fail('TAR output exceeds the 64 MiB limit.');
	const b=new Uint8Array(size); let p=0;
	const str=(s:string,offset:number)=>b.set(utf8.encode(s),p+offset);
	const num=(n:number,offset:number,length:number)=> {
		if(!Number.isSafeInteger(n)||n<0||n.toString(8).length>length-1) fail('TAR metadata is out of range.');
		str(n.toString(8).padStart(length-1,'0')+'\0',offset);
	};
	for(const e of entries) {
		let name=e.name, prefix='';
		if(utf8.encode(name).length>100) {
			let split=name.lastIndexOf('/',name.length-2);
			while(split>0 && utf8.encode(name.slice(0,split)).length>155) split=name.lastIndexOf('/',split-1);
			if(split<1 || utf8.encode(name.slice(split+1)).length>100) fail('Archive filename cannot fit a USTAR header.');
			prefix=name.slice(0,split); name=name.slice(split+1);
		}
		str(name,0); num(e.directory?0o755:0o644,100,8); num(0,108,8); num(0,116,8); num(e.data.length,124,12); num(e.mtime,136,12);
		b.fill(32,p+148,p+156); b[p+156]=e.directory?53:48; str('ustar\0'+'00',257); str(prefix,345);
		const sum=b.subarray(p,p+512).reduce((n,v)=>n+v,0); str(sum.toString(8).padStart(6,'0')+'\0 ',148);
		b.set(e.data,p+512); p+=512+Math.ceil(e.data.length/512)*512;
	}
	return b;
}
export async function decodeZip(b:Uint8Array):Promise<Entry[]> {
	if(b.length<22) fail('Corrupt ZIP directory.');
	const v=view(b); let end=b.length-22;
	while(end>=Math.max(0,b.length-65557) && v.getUint32(end,true)!==0x06054b50) end--;
	if(end<0 || end<Math.max(0,b.length-65557) || end+22+v.getUint16(end+20,true)!==b.length) fail('Corrupt ZIP end directory.');
	const count=v.getUint16(end+10,true), central=v.getUint32(end+16,true), length=v.getUint32(end+12,true);
	if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==count || count===65535 || central+length!==end) fail('Split/ZIP64 archives are not supported or ZIP is corrupt.');
	if(count>COUNT) fail('Archive exceeds the 1000 entries limit.');
	const entries:Entry[]=[], records:{start:number;offset:number;packed:number;size:number;crc:number;method:number;end:number}[]=[];
	let p=central,total=0;
	for(let i=0;i<count;i++) {
		if(p+46>end || v.getUint32(p,true)!==0x02014b50) fail('Corrupt ZIP central directory.');
		const flags=v.getUint16(p+8,true), method=v.getUint16(p+10,true), crc=v.getUint32(p+16,true), packed=v.getUint32(p+20,true), size=v.getUint32(p+24,true);
		const n=v.getUint16(p+28,true), extra=v.getUint16(p+30,true), comment=v.getUint16(p+32,true), offset=v.getUint32(p+42,true), attrs=v.getUint32(p+38,true);
		if(flags&~0x808 || ![0,8].includes(method) || v.getUint16(p+34,true) || [packed,size,offset].includes(0xffffffff)) fail('Encrypted, split, ZIP64 or unsupported ZIP compression.');
		if(p+46+n+extra+comment>end || offset+30>central) fail('Corrupt ZIP offsets.');
		const nameBytes=b.subarray(p+46,p+46+n);
		if(!(flags&0x800) && nameBytes.some(v=>v>127)) fail('ZIP filenames must use UTF-8 or ASCII.');
		const name=decoder.decode(nameBytes), directory=name.endsWith('/'), mode=attrs>>>16, kind=mode&0xf000;
		if(kind && kind!==(directory?0x4000:0x8000)) fail('ZIP links/devices are not allowed.');
		path(name,directory); total+=size;
		if(total>MAX || size>Math.max(packed*RATIO,1024*1024) || (directory&&size)) fail('Archive expansion size or compression ratio exceeds the limit.');
		if(v.getUint32(offset,true)!==0x04034b50 || v.getUint16(offset+6,true)!==flags || v.getUint16(offset+8,true)!==method) fail('Corrupt ZIP local header.');
		const localN=v.getUint16(offset+26,true), localExtra=v.getUint16(offset+28,true), data=offset+30+localN+localExtra;
		if(data+packed>central || localN!==n || !nameBytes.every((c,j)=>b[offset+30+j]===c)) fail('ZIP local filename/size mismatch.');
		if(!(flags&8) && (v.getUint32(offset+14,true)!==crc || v.getUint32(offset+18,true)!==packed || v.getUint32(offset+22,true)!==size)) fail('ZIP local size/checksum mismatch.');
		let recordEnd=data+packed;
		if(flags&8) {
			if(recordEnd+12>central) fail('Truncated ZIP data descriptor.');
			let d=recordEnd; if(v.getUint32(d,true)===0x08074b50) d+=4;
			if(d+12>central || v.getUint32(d,true)!==crc || v.getUint32(d+4,true)!==packed || v.getUint32(d+8,true)!==size) fail('ZIP data descriptor mismatch.');
			recordEnd=d+12;
		}
		const date=v.getUint16(p+14,true), time=v.getUint16(p+12,true);
		const mtime=Math.floor(Date.UTC(1980+(date>>>9),(date>>>5&15)-1,date&31,time>>>11,time>>>5&63,(time&31)*2)/1000);
		entries.push({name,data:new Uint8Array(),directory,mtime:Number.isFinite(mtime)&&mtime>=0?mtime:0});
		records.push({start:offset,offset:data,packed,size,crc,method,end:recordEnd});
		p+=46+n+extra+comment;
	}
	if(p!==end) fail('Corrupt ZIP directory length.');
	validateEntries(entries);
	// Reject aliased/overlapping records before any decompression allocation.
	const ranges=records.map(r=>({start:r.start,end:r.end})).sort((a,b)=>a.start-b.start);
	let last=0; for(const r of ranges) { if(r.start!==last) fail('ZIP overlapping records or unrecognized data.'); last=r.end; }
	if(last!==central) fail('ZIP unrecognized data before directory.');
	for(let i=0;i<records.length;i++) {
		const r=records[i], packed=b.subarray(r.offset,r.offset+r.packed);
		const data=r.method===0?packed:await transform(packed,'deflate-raw',true,r.size);
		if(data.length!==r.size || crc32(data)!==r.crc) fail('ZIP size or checksum mismatch.'); entries[i].data=data;
	}
	validateEntries(entries); return entries;
}
export async function encodeZip(entries:readonly Entry[], compressed:boolean):Promise<Uint8Array> {
	validateEntries(entries); const local:Uint8Array[]=[], central:Uint8Array[]=[]; let offset=0,centralSize=0;
	for(const e of entries) {
		const name=utf8.encode(e.name), data=compressed&&!e.directory?await transform(e.data,'deflate-raw',false):e.data, method=compressed&&!e.directory?8:0, crc=crc32(e.data);
		const h=new Uint8Array(30+name.length), c=new Uint8Array(46+name.length), hv=view(h), cv=view(c);
		const date=new Date(Math.max(Date.UTC(1980,0,1),Math.min(Date.UTC(2107,11,31),e.mtime*1000)));
		const dosDate=(date.getUTCFullYear()-1980)<<9|(date.getUTCMonth()+1)<<5|date.getUTCDate(), dosTime=date.getUTCHours()<<11|date.getUTCMinutes()<<5|Math.floor(date.getUTCSeconds()/2);
		hv.setUint32(0,0x04034b50,true); hv.setUint16(4,20,true); hv.setUint16(6,0x800,true); hv.setUint16(8,method,true); hv.setUint16(10,dosTime,true); hv.setUint16(12,dosDate,true);
		hv.setUint32(14,crc,true); hv.setUint32(18,data.length,true); hv.setUint32(22,e.data.length,true); hv.setUint16(26,name.length,true); h.set(name,30);
		cv.setUint32(0,0x02014b50,true); cv.setUint16(4,0x0314,true); c.set(h.subarray(4,26),6); cv.setUint16(28,name.length,true);
		cv.setUint32(38,((e.directory?0o40755:0o100644)<<16)>>>0,true); cv.setUint32(42,offset,true); c.set(name,46);
		local.push(h,data); central.push(c); offset+=h.length+data.length; centralSize+=c.length;
		if(offset+centralSize+22>MAX) fail('ZIP output exceeds the 64 MiB limit.');
	}
	const end=new Uint8Array(22), ev=view(end); ev.setUint32(0,0x06054b50,true); ev.setUint16(8,entries.length,true); ev.setUint16(10,entries.length,true); ev.setUint32(12,centralSize,true); ev.setUint32(16,offset,true);
	const result=new Uint8Array(offset+centralSize+22); let p=0; for(const b of [...local,...central,end]) { result.set(b,p); p+=b.length; } return result;
}
function supported(format:'gzip'|'deflate-raw',decompress=false) { try { if(decompress) new DecompressionStream(format); else new CompressionStream(format); return true; } catch { return false; } }
async function read(file:File, output=false) {
	if(!file.size || file.size>(output?MAX:INPUT)) fail('Archive input is empty or exceeds the size limit.');
	const b=new Uint8Array(await file.arrayBuffer()), definition=archiveFormats.find(f=>f.matches(b));
	if(!definition) fail('Unsupported archive contents.');
	const ext=file.name.includes('.')?file.name.split('.').pop()!.toLowerCase():'';
	if(ext&&!definition.extensions.includes(ext)) fail('Archive extension does not match its contents.');
	if(file.type && !['application/octet-stream',definition.mime,...(definition.id==='GZIP'?['application/x-gzip']:[])].includes(file.type)) fail('Archive MIME does not match its contents.');
	let entries:Entry[], format=definition.id;
	if(format==='ZIP') entries=await decodeZip(b);
	else if(format==='TAR') entries=decodeTar(b);
	else {
		const expanded=await transform(b,'gzip',true,Math.min(MAX,Math.max(1024*1024,b.length*RATIO)));
		if(archiveFormats.find(f=>f.id==='TAR')!.matches(expanded)) { entries=decodeTar(expanded); format='TAR.GZ'; }
		else {
			if(/\.(?:tar\.gz|tgz)$/i.test(file.name)) fail('The compressed contents are not a TAR archive.');
			const name=file.name.replace(/\.gz$/i,'')||'file'; entries=[{name,data:expanded,directory:false,mtime:0}];
		}
	}
	validateEntries(entries); return {entries,format,mime:definition.mime};
}
function outputs(entries:Entry[]) { return ['ZIP','TAR',...(supported('gzip')?['TAR.GZ',...(entries.filter(e=>!e.directory).length===1?['GZIP']:[])]:[])]; }
export const archiveCodec:EngineAdapter={
	async inspect(file,stage) {
		stage('reading'); const {entries,format,mime}=await read(file); stage('verifying');
		return {info:{format,mime,category:'archive',entries:entries.length},outputs:outputs(entries),preview:null};
	},
	async run(request,stage) {
		stage('reading'); const {entries}=await read(request.file); const format=request.format;
		if(!outputs(entries).includes(format)) fail('This archive output needs one file or is unsupported by this browser.');
		if(request.archive && !['store','deflate'].includes(request.archive.compression)) fail('Invalid ZIP compression setting.');
		stage('encoding'); let bytes:Uint8Array;
		if(format==='ZIP') bytes=await encodeZip(entries,request.archive?.compression!=='store'&&supported('deflate-raw'));
		else if(format==='TAR') bytes=encodeTar(entries);
		else if(format==='TAR.GZ') bytes=await transform(encodeTar(entries),'gzip',false);
		else bytes=await transform(entries.find(e=>!e.directory)!.data,'gzip',false);
		const def=archiveFormats.find(f=>f.id===format)!, blob=new Blob([bytes.slice()],{type:def.mime});
		const name=outputName(request.file.name.replace(/\.(tar\.gz|tgz)$/i,'.tar'),format);
		stage('verifying'); const verified=await read(new File([blob],name,{type:def.mime}),true);
		const expected=format==='GZIP'?entries.filter(e=>!e.directory):entries;
		if(verified.entries.length!==expected.length || expected.some((e,i)=>e.data.length!==verified.entries[i].data.length || !e.data.every((v,j)=>v===verified.entries[i].data[j]) || (format!=='GZIP'&&e.name!==verified.entries[i].name))) fail('Archive output verification failed.');
		return {blob,name,format,mime:def.mime};
	}
};
