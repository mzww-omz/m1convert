import type {EngineContext} from '../codec-registry.ts';

const MAX=64*1024**2;
type Bytes=Uint8Array<ArrayBuffer>;
export interface WasmArchiveEntry {
  name:string;directory:boolean;size:number;
  open:()=>ReadableStream<Bytes>;
}
function fail(message:string):never {throw new Error(message);}
async function collect(entry:WasmArchiveEntry,job:EngineContext):Promise<Bytes> {
  const reader=entry.open().getReader(),parts:Bytes[]=[];let total=0;
  try {
    for(;;) {
      job.signal.throwIfAborted();
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>entry.size||total>MAX)fail('WASM archive input exceeds its validated size.');
      parts.push(value);job.activity?.(value.byteLength);
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(total!==entry.size)fail('WASM archive source was truncated.');
  const bytes=new Uint8Array(total);let position=0;
  for(const part of parts){bytes.set(part,position);position+=part.byteLength;}
  return bytes;
}
export async function writeTarCompressed(
  entries:WasmArchiveEntry[],format:'TAR.XZ'|'TAR.BZ2',name:string,job:EngineContext
):Promise<Blob> {
  if(!entries.length||entries.some(e=>e.directory)||entries.some(e=>e.size<0||!Number.isSafeInteger(e.size)))
    fail('WASM compressed TAR output requires regular files; empty directories are not supported.');
  const total=entries.reduce((sum,e)=>sum+e.size,0);
  if(total>MAX)fail('Compressed TAR input exceeds the 64 MiB WASM budget.');
  const files:{file:File;pathname:string}[]=[];
  for(const entry of entries) {
    job.signal.throwIfAborted();
    const bytes=await collect(entry,job);
    files.push({file:new File([bytes],entry.name.split('/').at(-1)||'file'),pathname:entry.name});
  }
  job.signal.throwIfAborted();
  const {Archive,ArchiveCompression,ArchiveFormat}=await import('libarchive.js');
  Archive.init({workerUrl:'/vendor/libarchive/worker-bundle.js'});
  const result=await Archive.write({
    // libarchive.js 2.x publishes a recursive ArchiveEntryFile.file type in error.
    files:files as unknown as Parameters<typeof Archive.write>[0]['files'],outputFileName:name,
    format:ArchiveFormat.USTAR,
    compression:format==='TAR.XZ'?ArchiveCompression.XZ:ArchiveCompression.BZIP2,
    passphrase:null
  });
  job.signal.throwIfAborted();
  if(!result.size||result.size>MAX)fail('Compressed TAR output exceeds the 64 MiB WASM budget.');
  return result;
}
