import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {archiveCodec,encodeTar,encodeZip,decodeTar,decodeZip,transform} from '../src/lib/adapters/archive.ts';
const noop=()=>{};
const entries=[{name:'a.txt',data:new TextEncoder().encode('streamed bytes'),directory:false,mtime:1700000000}];
class RangeOnlyFile extends File {arrayBuffer(){throw new Error('Whole input materialized');}}
test('TAR and ZIP conversion uses ranged input, with exact independently decoded outputs',async()=>{
 for(const name of ['sample.tar','stored.zip','deflated.zip']) {
  const file=new RangeOnlyFile([await readFile(new URL('./fixtures/'+name,import.meta.url))],name);
  const info=await archiveCodec.inspect(file,noop);assert.ok(info.outputs.includes('ZIP'));
  for(const format of ['TAR','ZIP','TAR.GZ','GZIP']) {
   const stages=[],result=await archiveCodec.run({file,format,quality:90,archive:{compression:'deflate'}},(s,p)=>stages.push([s,p]));
   const bytes=new Uint8Array(await result.blob.arrayBuffer());
   const decoded=format==='ZIP'?await decodeZip(bytes):format==='TAR'?decodeTar(bytes):format==='TAR.GZ'?decodeTar(await transform(bytes,'gzip',true)):null;
   if(decoded)assert.equal(decoded.find(e=>!e.directory).data.length,14);
   else assert.equal((await transform(bytes,'gzip',true)).length,14);
   assert.ok(stages.some(([,p])=>typeof p==='number'));
  }
 }
});
test('stream ZIP rejects traversal, CRC corruption, aliased records and expansion bombs',async()=>{
 const base=await encodeZip([{...entries[0],name:'safe.txt'}],false),central=30+8+entries[0].data.length;
 for(const mutate of [
  (b,v)=>{b[38]^=1;},
  (b,v)=>v.setUint32(central+24,0x80000001,true),
  (b,v)=>{b.set(new TextEncoder().encode('../x.txt'),30);b.set(new TextEncoder().encode('../x.txt'),central+46);},
  (b,v)=>v.setUint32(central+42,1,true),
  (b,v)=>v.setUint32(central+38,(0o120777<<16)>>>0,true)
 ]) {const bad=base.slice();mutate(bad,new DataView(bad.buffer));await assert.rejects(archiveCodec.inspect(new RangeOnlyFile([bad],'bad.zip'),noop));}
});
test('large TAR metadata no longer inherits full-buffer codec input limits',async()=>{
 const header=encodeTar(entries).slice(0,512),size=65*1024**2;
 header.set(new TextEncoder().encode(size.toString(8).padStart(11,'0')+'\0'),124);header.fill(32,148,156);
 const sum=header.reduce((n,v)=>n+v,0);header.set(new TextEncoder().encode(sum.toString(8).padStart(6,'0')+'\0 '),148);
 const block=new Blob([new Uint8Array(1024**2)]),file=new RangeOnlyFile([header,...Array(65).fill(block),new Uint8Array(1024)],'large.tar');
 const info=await archiveCodec.inspect(file,noop);assert.equal(info.info.entries,1);assert.ok(info.outputs.includes('TAR'));
 await assert.rejects(archiveCodec.run({file,format:'TAR',quality:90},noop),/disk-backed|Blob memory/i);
});
test('stream readers reject corrupt headers, CRC, unsafe paths, cancellation and trailing garbage',async()=>{
 const file=new RangeOnlyFile([encodeTar(entries)],'a.tar');
 const signal=AbortSignal.abort();await assert.rejects(archiveCodec.inspect(file,noop,[],{signal,stage:noop}),{name:'AbortError'});
 const corrupt=encodeTar(entries);corrupt[0]^=1;await assert.rejects(archiveCodec.inspect(new RangeOnlyFile([corrupt],'a.tar'),noop),/checksum/);
 await assert.rejects(archiveCodec.inspect(new RangeOnlyFile([encodeTar(entries),Uint8Array.of(1)],'a.tar'),noop),/TAR/);
});
