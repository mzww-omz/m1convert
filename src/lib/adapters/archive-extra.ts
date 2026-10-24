import type {EngineContext} from '../codec-registry.ts';
import {validateEntries} from './archive.ts';

const MAX=64*1024**2,CHUNK=64*1024;
type RawEntry={path:string;type:string;size:number;lastModified:number;fileName:string};
type Bytes=Uint8Array<ArrayBuffer>;
export interface ExtraEntry {name:string;directory:boolean;mtime:number;size:number;open:()=>ReadableStream<Bytes>}
function fail(message:string):never {throw new Error(message);}
function stream(bytes:Bytes,job:EngineContext):ReadableStream<Bytes> {
	let pos=0;
	return new ReadableStream({pull(controller){
		try {
			job.signal.throwIfAborted();
			if(pos===bytes.length){controller.close();return;}
			const chunk=bytes.subarray(pos,Math.min(bytes.length,pos+CHUNK));pos+=chunk.length;
			controller.enqueue(chunk);job.activity?.(chunk.length);
		} catch(error){controller.error(error);}
	}}, {highWaterMark:0});
}
// Bounded fallback for formats not covered by the native streaming parser.
// We deliberately use libarchive's raw flat listFiles API: its getFilesObject
// builds objects from untrusted paths and is not safe against prototype keys.
export async function readExtraArchive(blob:Blob,name:string,job:EngineContext):Promise<ExtraEntry[]> {
	if(blob.size>MAX)fail('7z/RAR/compressed archive input exceeds the 64 MiB WASM budget.');
	const {Archive:ArchiveClass}=await import('libarchive.js');
	ArchiveClass.init({workerUrl:'/vendor/libarchive/worker-bundle.js'});
	const reader=await ArchiveClass.open(new File([blob],name));
	try {
		const internal=reader as unknown as {client:{listFiles():Promise<RawEntry[]>}};
		if(typeof internal.client?.listFiles!=='function')fail('Archive WASM interface is unavailable.');
		const raw=await internal.client.listFiles();
		if(!Array.isArray(raw)||raw.length===0)fail('Archive is empty or contains no supported file entries.');
		if(raw.length>1000)fail('Archive entry count exceeds the 1000-file safety limit.');
		let total=0;const entries:{entry:RawEntry;directory:boolean;name:string;mtime:number}[]=[];
		for(const entry of raw){
			if(!entry||typeof entry.path!=='string'||!Number.isSafeInteger(entry.size)||entry.size<0)
				fail('Corrupt archive entry metadata.');
			if(entry.type!=='FILE'&&entry.type!=='DIR')fail('Archive links, devices and unsupported entry types are not allowed.');
			const directory=entry.type==='DIR',path=entry.path.replace(/\\/g,'/');
			const normalized=directory&& !path.endsWith('/')?path+'/':path;
			total+=entry.size;
			if(directory&&entry.size!==0||total>MAX)fail('Archive expansion exceeds the 64 MiB WASM safety limit.');
			// libarchive.js exposes the nanosecond component, not POSIX mtime seconds.
			entries.push({entry,directory,name:normalized,mtime:0});
		}
		validateEntries(entries.map(({name,directory,mtime})=>({name,directory,mtime,data:new Uint8Array()})));
		const result:ExtraEntry[]=[];
		for(const {entry,directory,name,mtime} of entries){
			job.signal.throwIfAborted();
			let bytes:Bytes=new Uint8Array();
			if(!directory){
				const extracted=await reader.extractSingleFile(entry.path);
				if(extracted.size!==entry.size)fail('Archive extracted size does not match metadata.');
				bytes=new Uint8Array(await extracted.arrayBuffer());
				if(bytes.length!==entry.size)fail('Archive extraction was truncated.');
			}
			result.push({name,directory,mtime,size:bytes.length,open:()=>stream(bytes,job)});
			job.activity?.(bytes.length);
		}
		return result;
	} finally{await reader.close();}
}
