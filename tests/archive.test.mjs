import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { archiveCodec, encodeTar, decodeTar, encodeZip, decodeZip, validateEntries, transform } from '../src/lib/adapters/archive.ts';
const text = new TextEncoder();
const entries = [{name:'folder/', data:new Uint8Array(), directory:true, mtime:1700000000}, {name:'folder/hello.txt',data:text.encode('hello archive\n'),directory:false,mtime:1700000000}];
const noop = () => {};
test('TAR and ZIP round trips retain directory, bytes and bounded timestamps', async () => {
  for (const compressed of [false,true]) {
    const zip = await encodeZip(entries,compressed);
    const result = await decodeZip(zip);
    assert.deepEqual(result.map(e=>[e.name,[...e.data],e.directory]),entries.map(e=>[e.name,[...e.data],e.directory]));
    const corrupt=zip.slice(); corrupt[30+entries[0].name.length+30+entries[1].name.length]^=1;
    await assert.rejects(decodeZip(corrupt), /ZIP|checksum|corrupt|decompress/i);
  }
  assert.deepEqual(decodeTar(encodeTar(entries)),entries);
  const bad=encodeTar(entries); bad[0]^=1; assert.throws(()=>decodeTar(bad),/checksum/i);
  assert.throws(()=>decodeTar(encodeTar(entries).subarray(0,700)),/TAR|truncat/i);
});
test('archive names, links, duplicates, collisions and resource budgets are rejected', () => {
  for(const name of ['../x','a/../../x','/etc/x','C:/x','a\\x','a//x','./x','a/./x','a\0x','a:x','a./x','CON','aux.txt'])
    assert.throws(()=>validateEntries([{...entries[1],name}]),/path|name/i,name);
  for(const names of [['x','x'],['x','X'],['x','x/y'],['x/y','x']])
    assert.throws(()=>validateEntries(names.map(name=>({...entries[1],name}))),/duplicate|collision/i);
  assert.throws(()=>validateEntries(Array.from({length:1001},(_,i)=>({...entries[1],name:`f${i}`}))),/count|entries/i);
  const link=encodeTar(entries); link[156]=50;
  link.fill(32,148,156); const sum=link.subarray(0,512).reduce((a,b)=>a+b,0); text.encodeInto(sum.toString(8).padStart(6,'0')+'\0 ',link.subarray(148,156));
  assert.throws(()=>decodeTar(link),/type|link/i);
});
test('bounded gzip rejects corrupt streams and bombs while round-tripping real bytes', async () => {
  const gzip=await transform(text.encode('actual data'),'gzip',false,1024);
  assert.deepEqual(await transform(gzip,'gzip',true,1024),text.encode('actual data'));
  await assert.rejects(transform(gzip.subarray(0,-2),'gzip',true,1024),/decompress|corrupt/i);
  const bomb=await transform(new Uint8Array(100000),'gzip',false,200000);
  await assert.rejects(transform(bomb,'gzip',true,1000),/limit|expan/i);
});
test('independent Python ZIP/TAR/GZIP fixtures convert through every advertised route', async () => {
  for(const name of ['stored.zip','deflated.zip','sample.tar','sample.tar.gz','hello.txt.gz']) {
    const file=new File([await readFile(new URL('./fixtures/'+name,import.meta.url))],name);
    const analysis=await archiveCodec.inspect(file,noop);
    for(const format of analysis.outputs) {
      const result=await archiveCodec.run({file,format,quality:90},noop);
      assert.ok(result.blob.size>0);
    }
  }
});
test('ZIP rejects forged sizes, traversal, symlink modes and overlapping records', async () => {
  const base=await encodeZip([{...entries[1],name:'safe.txt'}],false);
  const central=30+8+entries[1].data.length;
  for(const mutate of [
    (b,v)=>v.setUint32(central+24,0x10000000,true),
    (b,v)=>{ b.set(text.encode('../x.txt'),30); b.set(text.encode('../x.txt'),central+46); },
    (b,v)=>v.setUint32(central+38,(0o120777<<16)>>>0,true),
    (b,v)=>v.setUint32(central+42,1,true),
    (b,v)=>v.setUint16(6,1,true)
  ]) {
    const bad=base.slice(); mutate(bad,new DataView(bad.buffer)); await assert.rejects(decodeZip(bad));
  }
});
test('only representable TAR routes are advertised and generated gzip/ZIP never trip bomb guards', async () => {
  const long=await encodeZip([{...entries[1],name:'x'.repeat(150)}],false);
  const analysis=await archiveCodec.inspect(new File([long],'long.zip'),noop);
  assert.ok(!analysis.outputs.includes('TAR')); assert.ok(!analysis.outputs.includes('TAR.GZ'));
  const repetitive=encodeTar([{...entries[1],name:'zeros.bin',data:new Uint8Array(2*1024**2)}]);
  const file=new File([repetitive],'zeros.tar');
  for(const format of ['ZIP','GZIP','TAR.GZ']) {
    const result=await archiveCodec.run({file,format,quality:90},noop);
    const check=await archiveCodec.inspect(new File([result.blob],result.name,{type:result.mime}),noop);
    assert.ok(check.outputs.includes('ZIP'));
  }
});
test('GZIP output verifies file bytes even when the single payload is itself a TAR archive', async () => {
  const nested=encodeTar(entries),zip=await encodeZip([{...entries[1],name:'nested.tar',data:nested}],false);
  const result=await archiveCodec.run({file:new File([zip],'nested.zip'),format:'GZIP',quality:90},noop);
  assert.deepEqual(await transform(new Uint8Array(await result.blob.arrayBuffer()),'gzip',true),nested);
});
test('missing native compression support hides gzip routes and ZIP falls back to real stored records', async () => {
  const bytes=await encodeZip(entries,false),compressed=await encodeZip(entries,true),file=new File([bytes],'stored.zip');
  const C=globalThis.CompressionStream,D=globalThis.DecompressionStream;
  try {
    globalThis.DecompressionStream=undefined;
    const analysis=await archiveCodec.inspect(file,noop);
    assert.deepEqual(analysis.outputs,['ZIP','TAR']);
    const result=await archiveCodec.run({file,format:'ZIP',quality:90},noop);
    assert.deepEqual((await decodeZip(new Uint8Array(await result.blob.arrayBuffer()))).map(e=>e.name),entries.map(e=>e.name));
    await assert.rejects(archiveCodec.inspect(new File([compressed],'compressed.zip'),noop),/support.*decompression/i);
  } finally {globalThis.CompressionStream=C;globalThis.DecompressionStream=D;}
});
test('archive adapter converts real TAR/ZIP/GZIP bytes with validated names and outputs', async () => {
  const tar=encodeTar(entries), file=new File([tar],'sample.tar',{type:'application/x-tar'});
  const analysis=await archiveCodec.inspect(file,noop);
  assert.equal(analysis.info.format,'TAR'); assert.ok(analysis.outputs.includes('ZIP'));
  for(const format of ['ZIP','TAR','TAR.GZ','GZIP']) {
    const result=await archiveCodec.run({file,format,quality:90,archive:{compression:'store'}},noop);
    assert.ok(result.blob.size>0);
    const check=await archiveCodec.inspect(new File([result.blob],result.name,{type:result.mime}),noop);
    assert.ok(check.outputs.includes('TAR'));
  }
  await assert.rejects(archiveCodec.inspect(new File([tar],'fake.zip'),noop),/extension/i);
  const many=encodeTar([...entries,{...entries[1],name:'other.txt'}]);
  assert.ok(!(await archiveCodec.inspect(new File([many],'x.tar'),noop)).outputs.includes('GZIP'));
  await assert.rejects(archiveCodec.run({file:new File([many],'x.tar'),format:'GZIP',quality:90},noop),/single|one file/i);
});
