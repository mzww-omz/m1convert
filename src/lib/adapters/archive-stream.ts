import type {EngineAdapter} from '../engine-types.ts';
import type {EngineContext} from '../codec-registry.ts';
import {archiveFormats} from '../archive-formats.ts';
import {ascii} from '../formats.ts';
import {outputName} from '../results.ts';
import {createOutput,STREAM_LIMIT} from '../stream-output.ts';
import {crc32,encodeTar,octal,tarString,tarName,validateEntries,supported} from './archive.ts';

const CHUNK=64*1024,utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
type Bytes=Uint8Array<ArrayBuffer>;
interface StreamEntry {name:string;directory:boolean;mtime:number;size:number;open:()=>ReadableStream<Bytes>}
function fail(message:string):never {throw new Error(message);}
const view=(b:Uint8Array)=>new DataView(b.buffer,b.byteOffset,b.byteLength);
async function range(blob:Blob,start:number,size:number,job:EngineContext) {
	job.signal.throwIfAborted();
	if(start<0||size<0||start+size>blob.size)fail('Corrupt archive offsets or truncated data.');
	const bytes=new Uint8Array(await blob.slice(start,start+size).arrayBuffer());job.signal.throwIfAborted();job.activity?.(bytes.byteLength);return bytes;
}
// Explicit range size also bounds browsers whose Blob.stream() chunk size differs.
function blobStream(blob:Blob,job:EngineContext):ReadableStream<Bytes> {
	let offset=0;
	return new ReadableStream({async pull(controller) {
		try {
			if(offset===blob.size){controller.close();return;}
			const b=await range(blob,offset,Math.min(CHUNK,blob.size-offset),job);offset+=b.length;controller.enqueue(b);
		} catch(error){controller.error(error);}
	}}, {highWaterMark:0});
}
async function* chunks(stream:ReadableStream<Bytes>,job:EngineContext) {
	const reader=stream.getReader();
	try {for(;;){job.signal.throwIfAborted();const {done,value}=await reader.read();job.signal.throwIfAborted();if(done)return;yield value;}}
	finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function fromGenerator(generator:AsyncGenerator<Bytes>):ReadableStream<Bytes> {
	return new ReadableStream({async pull(c){try{const r=await generator.next();if(r.done)c.close();else c.enqueue(r.value);}catch(e){c.error(e);}},async cancel(){await generator.return(undefined);}}, {highWaterMark:0});
}
function metadata(entries:StreamEntry[]) {
	validateEntries(entries.map(e=>({...e,data:new Uint8Array()})));
	if(entries.reduce((n,e)=>n+e.size,0)>STREAM_LIMIT)fail('Archive expansion exceeds the 2 GiB streaming safety limit. Split the archive.');
}
async function zeroes(blob:Blob,start:number,size:number,job:EngineContext) {
	for await(const b of chunks(blobStream(blob.slice(start,start+size),job),job))if(b.some(v=>v!==0))fail('Corrupt TAR padding or end marker.');
}
async function readTar(blob:Blob,job:EngineContext):Promise<StreamEntry[]> {
	if(blob.size<1024||blob.size%512)fail('Corrupt or truncated TAR.');
	const entries:StreamEntry[]=[];let p=0;
	while(p+512<=blob.size) {
		job.stage('reading',Math.min(20,p/blob.size*20));
		const h=await range(blob,p,512,job);
		if(h.every(v=>v===0)) {if(p+1024>blob.size)fail('Truncated TAR end marker.');await zeroes(blob,p,blob.size-p,job);metadata(entries);return entries;}
		if(entries.length>=1000)fail('Archive exceeds the 1000 entries limit.');
		let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:h[i];
		if(sum!==octal(h,148,8))fail('Invalid TAR header checksum.');
		if(ascii(h,257,6)!=='ustar\0'||ascii(h,263,2)!=='00')fail('Only POSIX USTAR TAR is supported.');
		const type=h[156],directory=type===53;if(![0,48,53].includes(type)||tarString(h,157,100))fail('Unsupported TAR entry type: links, devices and extensions are not allowed.');
		const prefix=tarString(h,345,155),name=(prefix?prefix+'/':'')+tarString(h,0,100),size=octal(h,124,12),start=p+512,end=start+size,next=start+Math.ceil(size/512)*512;
		if(next>blob.size||directory&&size)fail('Corrupt TAR size or directory data.');
		await zeroes(blob,end,next-end,job);
		entries.push({name,directory,size,mtime:octal(h,136,12),open:()=>blobStream(blob.slice(start,end),job)});metadata(entries);p=next;
	}
	return fail('Truncated TAR end marker.');
}
async function readZip(blob:Blob,job:EngineContext):Promise<StreamEntry[]> {
	if(blob.size<22)fail('Corrupt ZIP directory.');
	const tail=await range(blob,Math.max(0,blob.size-65557),Math.min(blob.size,65557),job),t=view(tail);let e=tail.length-22;
	while(e>=0&&t.getUint32(e,true)!==0x06054b50)e--;
	if(e<0||e+22+t.getUint16(e+20,true)!==tail.length)fail('Corrupt ZIP end directory.');
	const end=blob.size-tail.length+e,count=t.getUint16(e+10,true),central=t.getUint32(e+16,true),length=t.getUint32(e+12,true);
	if(t.getUint16(e+4,true)||t.getUint16(e+6,true)||t.getUint16(e+8,true)!==count||count===65535||central+length!==end)fail('Split/ZIP64 archives are not supported or ZIP is corrupt.');
	if(count>1000)fail('Archive exceeds the 1000 entries limit.');
	const entries:StreamEntry[]=[],records:{start:number;end:number}[]=[];let p=central,nameBytes=0;
	for(let i=0;i<count;i++) {
		const h=await range(blob,p,46,job),v=view(h);
		if(p+46>end||v.getUint32(0,true)!==0x02014b50)fail('Corrupt ZIP central directory.');
		const flags=v.getUint16(8,true),method=v.getUint16(10,true),crc=v.getUint32(16,true),packed=v.getUint32(20,true),size=v.getUint32(24,true),n=v.getUint16(28,true),extra=v.getUint16(30,true),comment=v.getUint16(32,true),offset=v.getUint32(42,true),attrs=v.getUint32(38,true);
		if(flags&~0x808||![0,8].includes(method)||v.getUint16(34,true)||[packed,size,offset].includes(0xffffffff))fail('Encrypted, split, ZIP64 or unsupported ZIP compression.');
		if(p+46+n+extra+comment>end||offset+30>central)fail('Corrupt ZIP offsets.');
		nameBytes+=n;if(nameBytes>1024**2)fail('Safety limit: archive filename metadata exceeds the 1 MiB memory budget.');
		const nameData=await range(blob,p+46,n,job);if(!(flags&0x800)&&nameData.some(b=>b>127))fail('ZIP filenames must use UTF-8 or ASCII.');
		const name=decoder.decode(nameData),directory=name.endsWith('/'),kind=attrs>>>16&0xf000;
		if(kind&&kind!==(directory?0x4000:0x8000)||directory&&size)fail('ZIP links/devices or directory data are not allowed.');
		const local=await range(blob,offset,30,job),l=view(local),localN=l.getUint16(26,true),data=offset+30+localN+l.getUint16(28,true);
		if(l.getUint32(0,true)!==0x04034b50||l.getUint16(6,true)!==flags||l.getUint16(8,true)!==method||data+packed>central||localN!==n)fail('Corrupt ZIP local header.');
		const localName=await range(blob,offset+30,localN,job);if(!nameData.every((b,j)=>b===localName[j]))fail('ZIP local filename mismatch.');
		if(!(flags&8)&&(l.getUint32(14,true)!==crc||l.getUint32(18,true)!==packed||l.getUint32(22,true)!==size))fail('ZIP local size/checksum mismatch.');
		let recordEnd=data+packed;
		if(flags&8) {
			const d=await range(blob,recordEnd,Math.min(16,central-recordEnd),job),dv=view(d);let q=d.length>=4&&dv.getUint32(0,true)===0x08074b50?4:0;
			if(q+12>d.length||dv.getUint32(q,true)!==crc||dv.getUint32(q+4,true)!==packed||dv.getUint32(q+8,true)!==size)fail('ZIP data descriptor mismatch.');recordEnd+=q+12;
		}
		if(method===0&&packed!==size)fail('ZIP stored size mismatch.');
		const date=v.getUint16(14,true),time=v.getUint16(12,true),mtime=Math.floor(Date.UTC(1980+(date>>>9),(date>>>5&15)-1,date&31,time>>>11,time>>>5&63,(time&31)*2)/1000);
		entries.push({name,directory,size,mtime:Number.isFinite(mtime)&&mtime>=0?mtime:0,open:()=>{
			let stream=blobStream(blob.slice(data,data+packed),job);
			if(method===8) {if(!supported('deflate-raw',true))fail('This browser does not support deflate-raw decompression.');stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));}
			return fromGenerator((async function*(){let total=0,actual=0;for await(const b of chunks(stream,job)){total+=b.length;if(total>size)fail('ZIP expansion exceeds declared size.');actual=crc32(b,actual);yield b;}if(total!==size||actual!==crc)fail('ZIP size or checksum mismatch.');})());
		}});
		records.push({start:offset,end:recordEnd});metadata(entries);p+=46+n+extra+comment;
	}
	if(p!==end)fail('Corrupt ZIP directory length.');
	records.sort((a,b)=>a.start-b.start);let last=0;for(const r of records){if(r.start!==last)fail('ZIP overlapping records or unrecognized data.');last=r.end;}
	if(last!==central)fail('ZIP unrecognized data before directory.');return entries;
}
async function unGzip(blob:Blob,job:EngineContext) {
	if(!supported('gzip',true))fail('This browser does not support gzip decompression.');
	const sink=await createOutput(job,'application/octet-stream');
	try {
		for await(const b of chunks(blobStream(blob,job).pipeThrough(new DecompressionStream('gzip')),job)) {await sink.write(b);job.stage('decoding');}
		return (await sink.finish()).blob;
	} catch(error){await sink.abort();throw error;}
}
async function unZstd(blob:Blob,job:EngineContext):Promise<Blob> {
	const {Decompress}=await import('fzstd');
	const pieces:Uint8Array<ArrayBuffer>[]=[];let total=0;
	const decoder=new Decompress(chunk=>{
		total+=chunk.byteLength;
		if(total>64*1024**2)fail('Zstandard expansion exceeds the 64 MiB memory safety limit.');
		pieces.push(chunk.slice());
	});
	for await(const chunk of chunks(blobStream(blob,job),job))decoder.push(chunk);
	decoder.push(new Uint8Array(),true);
	return new Blob(pieces,{type:'application/octet-stream'});
}
async function readAr(blob:Blob,job:EngineContext):Promise<StreamEntry[]> {
	const marker=await range(blob,0,Math.min(8,blob.size),job);
	if(ascii(marker,0,8)!=='!<arch>\n')fail('Invalid Unix ar archive header.');
	const entries:StreamEntry[]=[];let p=8;let names:Uint8Array|undefined;
	const number=(value:string)=>{
		const v=value.trim();if(!/^\d+$/.test(v))fail('Invalid Unix ar numeric metadata.');
		const n=Number(v);if(!Number.isSafeInteger(n)||n<0)fail('Unix ar numeric metadata exceeds its safe range.');
		return n;
	};
	while(p<blob.size) {
		job.signal.throwIfAborted();
		if(p+60>blob.size)fail('Truncated Unix ar entry header.');
		const h=await range(blob,p,60,job);
		if(h[58]!==96||h[59]!==10)fail('Invalid Unix ar entry marker.');
		const raw=ascii(h,0,16).trim(),mtime=number(ascii(h,16,12)),size=number(ascii(h,48,10));
		const start=p+60,end=start+size,next=end+(size%2);
		if(end>blob.size||next>blob.size)fail('Truncated Unix ar entry data.');
		if(size%2){const padding=await range(blob,end,1,job);if(padding[0]!==10)fail('Invalid Unix ar padding.');}
		let name=raw,dataStart=start;
		if(raw==='//') {
			if(size>1024**2)fail('Unix ar filename table exceeds the 1 MiB budget.');
			names=await range(blob,start,size,job);p=next;continue;
		}
		if(raw==='/'||raw==='/SYM64/'||raw==='__.SYMDEF'||raw==='__.SYMDEF SORTED'){p=next;continue;}
		if(/^\/\d+$/.test(raw)){
			if(!names)fail('Unix ar references a missing long-filename table.');
			const offset=number(raw.slice(1));if(offset>=names.length)fail('Invalid Unix ar filename table offset.');
			let e=offset;while(e<names.length&&names[e]!==10)e++;
			if(e===names.length)fail('Unterminated Unix ar long filename.');
			name=decoder.decode(names.subarray(offset,e)).replace(/\/$/,'');
		} else if(/^#1\/\d+$/.test(raw)) {
			const length=number(raw.slice(3));if(length>size||length>65535)fail('Invalid BSD ar extended filename length.');
			name=decoder.decode(await range(blob,start,length,job));dataStart+=length;
		} else name=raw.replace(/\/$/,'');
		if(!name||name.includes('\0'))fail('Unsafe Unix ar filename.');
		const dataSize=end-dataStart;
		entries.push({name,directory:false,mtime,size:dataSize,open:()=>blobStream(blob.slice(dataStart,end),job)});
		metadata(entries);
		p=next;
	}
	if(!entries.length)fail('Unix ar archive contains no regular files.');
	metadata(entries);return entries;
}
async function readArchive(blob:Blob,name:string,job:EngineContext) {
	job.signal.throwIfAborted();job.streaming?.();
	if(!blob.size)fail('Archive input is empty.');
	const head=await range(blob,0,Math.min(4096,blob.size),job),definition=archiveFormats.find(f=>f.matches(head));
	if(!definition)fail('Unsupported archive contents.');
	if(definition.id==='AR')return {entries:await readAr(blob,job),format:'AR',mime:definition.mime};
	if(definition.id==='ZIP')return {entries:await readZip(blob,job),format:'ZIP',mime:definition.mime};
	if(definition.id==='TAR')return {entries:await readTar(blob,job),format:'TAR',mime:definition.mime};
	if(definition.id==='ZSTD') {
		if(blob.size>64*1024**2)fail('Zstandard input exceeds the 64 MiB safety limit.');
		const expanded=await unZstd(blob,job),header=await range(expanded,0,Math.min(4096,expanded.size),job);
		if(archiveFormats.find(f=>f.id==='TAR')!.matches(header))return {entries:await readTar(expanded,job),format:'ZSTD',mime:definition.mime};
		const filename=name.replace(/\.(?:zst|tzst)$/i,'')||'file';
		const entries=[{name:filename,size:expanded.size,directory:false,mtime:0,open:()=>blobStream(expanded,job)}];metadata(entries);
		return {entries,format:'ZSTD',mime:definition.mime};
	}
	if(['7Z','RAR','XZ','BZ2'].includes(definition.id)) {
		const {readExtraArchive}=await import('./archive-extra.ts');
		return {entries:await readExtraArchive(blob,name,job),format:definition.id,mime:definition.mime};
	}
	const expanded=await unGzip(blob,job),header=await range(expanded,0,Math.min(4096,expanded.size),job);
	if(archiveFormats.find(f=>f.id==='TAR')!.matches(header))return {entries:await readTar(expanded,job),format:'TAR.GZ',mime:definition.mime};
	const entries=[{name:name.replace(/\.gz$/i,'')||'file',size:expanded.size,directory:false,mtime:0,open:()=>blobStream(expanded,job)}];metadata(entries);
	return {entries,format:'GZIP',mime:definition.mime};
}
function outputs(entries:StreamEntry[]) {
	const tar=entries.every(e=>tarName(e.name))&&1024+entries.reduce((n,e)=>n+512+Math.ceil(e.size/512)*512,0)<=STREAM_LIMIT;
	const wasmTar=typeof Worker!=='undefined'&&tar&&entries.length>0&&entries.every(e=>!e.directory)&&entries.reduce((n,e)=>n+e.size,0)<=64*1024**2;
	return ['ZIP',...(tar?['TAR']:[]),...(supported('gzip')&&supported('gzip',true)?[...(tar?['TAR.GZ']:[]),...(entries.filter(e=>!e.directory).length===1?['GZIP']:[])]:[]),...(wasmTar?['TAR.XZ','TAR.BZ2']:[])];
}
async function* tarChunks(entries:StreamEntry[],job:EngineContext,onBytes:(n:number)=>void) {
	for(const entry of entries) {
		const header=encodeTar([{...entry,data:new Uint8Array()}]).slice(0,512);
		header.set(utf8.encode(entry.size.toString(8).padStart(11,'0')+'\0'),124);header.fill(32,148,156);
		header.set(utf8.encode(header.reduce((sum,v)=>sum+v,0).toString(8).padStart(6,'0')+'\0 '),148);yield header;
		for await(const b of chunks(entry.open(),job)){onBytes(b.length);yield b;}
		if(entry.size%512)yield new Uint8Array(512-entry.size%512);
	}
	yield new Uint8Array(1024);
}
async function* zipChunks(entries:StreamEntry[],compressed:boolean,job:EngineContext,onBytes:(n:number)=>void) {
	const central:Bytes[]=[];let offset=0;
	for(const entry of entries) {
		const name=utf8.encode(entry.name),h=new Uint8Array(30+name.length),c=new Uint8Array(46+name.length),v=view(h),cv=view(c),method=compressed&&!entry.directory?8:0;
		const date=new Date(Math.max(Date.UTC(1980,0,1),Math.min(Date.UTC(2107,11,31),entry.mtime*1000)));
		v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x808,true);v.setUint16(8,method,true);
		v.setUint16(10,date.getUTCHours()<<11|date.getUTCMinutes()<<5|Math.floor(date.getUTCSeconds()/2),true);v.setUint16(12,(date.getUTCFullYear()-1980)<<9|(date.getUTCMonth()+1)<<5|date.getUTCDate(),true);v.setUint16(26,name.length,true);h.set(name,30);yield h;
		let crc=0,packed=0;
		let stream=fromGenerator((async function*(){for await(const b of chunks(entry.open(),job)){crc=crc32(b,crc);onBytes(b.length);yield b;}})());
		if(method===8)stream=stream.pipeThrough(new CompressionStream('deflate-raw'));
		for await(const b of chunks(stream,job)){packed+=b.length;yield b;}
		const descriptor=new Uint8Array(16),d=view(descriptor);d.setUint32(0,0x08074b50,true);d.setUint32(4,crc,true);d.setUint32(8,packed,true);d.setUint32(12,entry.size,true);yield descriptor;
		cv.setUint32(0,0x02014b50,true);cv.setUint16(4,0x0314,true);c.set(h.subarray(4,26),6);cv.setUint32(16,crc,true);cv.setUint32(20,packed,true);cv.setUint32(24,entry.size,true);cv.setUint16(28,name.length,true);cv.setUint32(38,((entry.directory?0o40755:0o100644)<<16)>>>0,true);cv.setUint32(42,offset,true);c.set(name,46);central.push(c);offset+=h.length+packed+16;
	}
	const end=new Uint8Array(22),v=view(end),size=central.reduce((n,c)=>n+c.length,0);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
	for(const c of central)yield c;yield end;
}
async function equalStreams(a:ReadableStream<Bytes>,b:ReadableStream<Bytes>,job:EngineContext,onBytes:(n:number)=>void) {
	const left=a.getReader(),right=b.getReader();let x=new Uint8Array(0),y=new Uint8Array(0),i=0,j=0,ld=false,rd=false;
	try {for(;;) {
		job.signal.throwIfAborted();
		if(i===x.length&&!ld){const r=await left.read();ld=!!r.done;x=r.value??new Uint8Array();i=0;}
		if(j===y.length&&!rd){const r=await right.read();rd=!!r.done;y=r.value??new Uint8Array();j=0;}
		if(ld||rd){if(ld!==rd)fail('Archive output verification size mismatch.');return;}
		const count=Math.min(x.length-i,y.length-j);for(let k=0;k<count;k++)if(x[i+k]!==y[j+k])fail('Archive output verification byte mismatch.');i+=count;j+=count;onBytes(count);
	}} finally {await Promise.all([left.cancel().catch(()=>{}),right.cancel().catch(()=>{})]);left.releaseLock();right.releaseLock();}
}
export const streamArchiveCodec:EngineAdapter={
	async inspect(file,stage,_verified,context) {
		const job=context??{signal:new AbortController().signal,stage};stage('reading');const {entries,format,mime}=await readArchive(file,file.name,job);
		let processed=0;const total=entries.reduce((n,e)=>n+e.size,0);
		// TAR payloads have no checksums; headers/padding suffice. Gzip CRC was checked while spooling.
		if(format==='ZIP')for(const entry of entries)for await(const b of chunks(entry.open(),job)){processed+=b.length;stage('verifying',total?processed/total*95:95);}
		else stage('verifying');
		return {info:{format,mime,category:'archive',entries:entries.length},outputs:outputs(entries),preview:null,warnings:entries.some(e=>utf8.encode(e.name).length>255)?['Compatibility warning: long archive paths may not extract on every operating system. ZIP preserves the original paths.']:[]};
	},
	async run(request,stage,context) {
		const job=context??{signal:new AbortController().signal,stage};stage('reading');const {entries}=await readArchive(request.file,request.file.name,job),format=request.format;
		if(!outputs(entries).includes(format))fail('This archive output needs one file or is unsupported by this browser.');
		if(request.archive&&!['store','deflate'].includes(request.archive.compression))fail('Invalid ZIP compression setting.');
		const def=archiveFormats.find(f=>f.id===format)!,name=outputName(request.file.name.replace(/\.(tar\.(?:gz|bz2|xz|zst)|tgz|tbz2|txz|tzst)$/i,'.tar'),format),sink=await createOutput(job,def.mime);
		const total=entries.reduce((n,e)=>n+e.size,0);let processed=0;
		const onBytes=(n:number)=>{processed+=n;stage('encoding',total?processed/total*85:85);};
		try {
			if(format==='TAR.XZ'||format==='TAR.BZ2') {
				const {writeTarCompressed}=await import('./archive-write-extra.ts');
				const encoded=await writeTarCompressed(entries,format,name,job);
				for await(const b of chunks(blobStream(encoded,job),job))await sink.write(b);
			} else {
				let stream:ReadableStream<Bytes>;
				if(format==='ZIP')stream=fromGenerator(zipChunks(entries,request.archive?.compression!=='store'&&supported('deflate-raw')&&supported('deflate-raw',true),job,onBytes));
				else if(format==='GZIP')stream=fromGenerator((async function*(){for await(const b of chunks(entries.find(e=>!e.directory)!.open(),job)){onBytes(b.length);yield b;}})());
				else stream=fromGenerator(tarChunks(entries,job,onBytes));
				if(['GZIP','TAR.GZ'].includes(format))stream=stream.pipeThrough(new CompressionStream('gzip'));
				for await(const b of chunks(stream,job))await sink.write(b);
			}
			const output=await sink.finish();stage('verifying',85);processed=0;
			const onVerified=(n:number)=>{processed+=n;stage('verifying',85+(total?processed/total*14:14));};
			if(format==='GZIP') {
				await equalStreams(blobStream(output.blob,job).pipeThrough(new DecompressionStream('gzip')),entries.find(e=>!e.directory)!.open(),job,onVerified);
			} else {
				const verified=await readArchive(output.blob,name,{...job,stage:()=>stage('verifying',85)});
				if(verified.entries.length!==entries.length)fail('Archive output verification entry count mismatch.');
				for(let i=0;i<entries.length;i++) {const a=entries[i],b=verified.entries[i];if(a.name!==b.name||a.directory!==b.directory||a.size!==b.size)fail('Archive output verification metadata mismatch.');await equalStreams(a.open(),b.open(),job,onVerified);}
			}
			return {...output,name,format,mime:def.mime,resources:{...sink.metrics}};
		} catch(error){await sink.abort();throw error;}
	}
};
