// Node process peak RSS, not a browser/WASM peak-memory measurement.
import {openAsBlob} from 'node:fs';
import {mkdir,open,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {archiveCodec,encodeTar,decodeTar,encodeZip,decodeZip} from '../src/lib/adapters/archive.ts';

if(process.argv[2]==='child') {
 const [, , ,mode,path]=process.argv,file=new File([await openAsBlob(path)],'source.tar');
 const started=performance.now();let output;
 if(mode==='buffered') {
  // Phase 6 TAR -> stored ZIP path including its whole-output verification.
  const bytes=new Uint8Array(await file.arrayBuffer()),entries=decodeTar(bytes),encoded=await encodeZip(entries,false),blob=new Blob([encoded.slice()]);
  const checked=await decodeZip(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(checked.length,entries.length);for(let i=0;i<entries.length;i++)assert.ok(checked[i].data.length===entries[i].data.length&&entries[i].data.every((value,j)=>value===checked[i].data[j]));
  output={blob};
 } else output=await archiveCodec.run({file,format:'ZIP',quality:90,archive:{compression:'store'}},()=>{});
 console.log(JSON.stringify({mode,inputBytes:file.size,outputBytes:output.blob.size,elapsedMs:performance.now()-started,processPeakRssKiB:process.resourceUsage().maxRSS,resources:output.resources}));
} else {
 const dir='artifacts/phase7';await mkdir(dir,{recursive:true});const results=[];
 for(const size of [64*1024,8*1024**2,48*1024**2]) {
  const path=`${dir}/benchmark-${size}.tar`,header=encodeTar([{name:'data.bin',directory:false,mtime:0,data:new Uint8Array()}]).slice(0,512);
  header.set(new TextEncoder().encode(size.toString(8).padStart(11,'0')+'\0'),124);header.fill(32,148,156);header.set(new TextEncoder().encode(header.reduce((n,v)=>n+v,0).toString(8).padStart(6,'0')+'\0 '),148);
  const file=await open(path,'w'),block=Uint8Array.from({length:65536},(_,i)=>i%251);
  try{await file.write(header);for(let p=0;p<size;p+=block.length)await file.write(block.subarray(0,Math.min(block.length,size-p)));await file.write(new Uint8Array(1024));}finally{await file.close();}
  for(const mode of ['buffered','streaming']) {
   const child=spawnSync(process.execPath,[import.meta.filename,'child',mode,path],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
   const result=JSON.parse(child.stdout);results.push(result);console.log(result);
  }
 }
 await writeFile(`${dir}/benchmark.json`,JSON.stringify({runtime:process.version,platform:process.platform,measurement:'Fresh Node process resourceUsage().maxRSS (KiB); includes runtime and bounded Blob output, not browser OPFS, OS file cache or unique process-tree memory. One observation per case; no extrapolated values.',results},null,2));
}
