import type {EngineContext} from './codec-registry.ts';
export const STREAM_LIMIT=2*1024**3, BLOB_LIMIT=64*1024**2;
export const TEMP_DIRECTORY='convert-temporary';
export interface StoredOutput {blob:Blob;temporaryFile?:string}
export async function prepareTemporary(name:string):Promise<void> {
	if(!/^convert-[\da-f-]+$/.test(name))throw new Error('Invalid temporary output name.');
	const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle(TEMP_DIRECTORY,{create:true});
	await directory.getFileHandle(name,{create:true});
}
export async function releaseTemporary(name:string):Promise<void> {
	if(!/^convert-[\da-f-]+$/.test(name))throw new Error('Invalid temporary output name.');
	for(let attempt=0;;attempt++)try {
		const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle(TEMP_DIRECTORY);
		await directory.removeEntry(name);return;
	} catch(error) {
		if((error as DOMException).name==='NotFoundError')return;
		if(attempt>=4)throw error;
		await new Promise(resolve=>setTimeout(resolve,50));
	}
}
export async function createOutput(job:EngineContext,mime:string,limit=STREAM_LIMIT) {
	job.signal.throwIfAborted();
	let writer:FileSystemWritableFileStream|undefined,handle:FileSystemFileHandle|undefined,temporaryFile:string|undefined;
	// Only the Worker host, which owns cleanup on termination, may create disk outputs.
	if(job.temporary&&typeof navigator!=='undefined'&&navigator.storage?.getDirectory)try {
		const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle(TEMP_DIRECTORY,{create:true});
		const estimate=await navigator.storage.estimate();
		if(estimate.quota!==undefined&&estimate.usage!==undefined)limit=Math.min(limit,Math.max(0,Math.floor((estimate.quota-estimate.usage)*.8)));
		temporaryFile=`convert-${crypto.randomUUID()}`;await job.temporary(temporaryFile);
		handle=await directory.getFileHandle(temporaryFile);writer=await handle.createWritable();
	} catch(error) {
		if(temporaryFile)await releaseTemporary(temporaryFile);
		if(!['NotSupportedError','SecurityError'].includes((error as DOMException).name))throw new Error('Temporary disk output could not open. Free browser storage and retry.');
		temporaryFile=undefined;handle=undefined;
	}
	if(!writer)limit=Math.min(limit,BLOB_LIMIT);
	const chunks:Blob[]=[],metrics={mode:writer?'opfs':'blob',bytesWritten:0,maxChunkBytes:0,retainedBytes:0};
	let closed=false;
	return {
		metrics,
		async write(bytes:Uint8Array) {
			job.signal.throwIfAborted();
			if(closed)throw new Error('Output is already closed.');
			if(metrics.bytesWritten+bytes.byteLength>limit)throw new Error(writer?'Streaming output exceeds the disk/2 GiB safety limit. Free browser storage or split the archive.':'This browser has no disk-backed output; the 64 MiB Blob memory budget was exceeded. Use an OPFS-capable browser or split the archive.');
			if(writer)try {await writer.write(bytes as Uint8Array<ArrayBuffer>);}
			catch {throw new Error('Temporary disk output failed (storage quota or I/O). Free browser storage and retry.');}
			else {chunks.push(new Blob([bytes as Uint8Array<ArrayBuffer>]));metrics.retainedBytes+=bytes.byteLength;}
			job.activity?.(bytes.byteLength);
			metrics.bytesWritten+=bytes.byteLength;metrics.maxChunkBytes=Math.max(metrics.maxChunkBytes,bytes.byteLength);
		},
		async finish():Promise<StoredOutput> {
			job.signal.throwIfAborted();if(closed)throw new Error('Output is already closed.');
			if(writer) {await writer.close();closed=true;return {blob:(await handle!.getFile()).slice(0,metrics.bytesWritten,mime),temporaryFile};}
			closed=true;const blob=new Blob(chunks,{type:mime});chunks.length=0;return {blob};
		},
		async abort() {
			if(!closed&&writer)await writer.abort().catch(()=>{});closed=true;chunks.length=0;
			if(temporaryFile)await releaseTemporary(temporaryFile);
		}
	};
}
