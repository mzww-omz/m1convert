import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectFile,checkDimensions} from '../src/lib/image-format.ts';
import {archiveCodec,transform,encodeTar} from '../src/lib/adapters/archive.ts';
const noop=()=>{};
test('image contents win over both wrong extension and MIME; invalid contents still fail',async()=>{
 const png=await readFile(new URL('./fixtures/swatch.png',import.meta.url));
 assert.equal((await inspectFile(new File([png],'photo.exe',{type:'text/plain'}))).format,'PNG');
 await assert.rejects(inspectFile(new File([png.subarray(0,30)],'photo.png',{type:'image/png'})),/corrupt|truncated/i);
 await assert.rejects(inspectFile(new File(['not an image'],'photo.png',{type:'image/png'})),/supported/i);
});
test('gzip subtype comes only from expanded contents, including empty TAR',async()=>{
 const bytes=await transform(new TextEncoder().encode('hello'),'gzip',false);
 const file=new File([bytes],'wrong.tar.gz',{type:'image/png'});
 assert.equal((await archiveCodec.inspect(file,noop)).info.format,'GZIP');
 const tar=await transform(encodeTar([]),'gzip',false);
 assert.equal((await archiveCodec.inspect(new File([tar],'unknown.bin'),noop)).info.format,'TAR.GZ');
});
test('long and high-pixel images use a combined allocation budget, not independent geometric caps',()=>{
 assert.doesNotThrow(()=>checkDimensions(10000,1,100));
 assert.doesNotThrow(()=>checkDimensions(4096,4096,100));
 assert.doesNotThrow(()=>checkDimensions(1,1,134217722)); // exactly 256 MiB
 assert.throws(()=>checkDimensions(1,1,134217723),/memory|budget/i);
 for(const dims of [[0,1],[1,-1],[NaN,1],[1.5,2],[Number.MAX_SAFE_INTEGER,2]])assert.throws(()=>checkDimensions(...dims,100));
});
test('real input above the former 32 MiB cap is parsed without bypassing structure checks',async()=>{
 // Valid small PNG with a large ancillary text chunk; malformed chunk lengths must still fail.
 const png=await readFile(new URL('./fixtures/swatch.png',import.meta.url));
 const chunk=Buffer.alloc(33*1024**2+12);chunk.writeUInt32BE(chunk.length-12);chunk.write('tEXt',4);
 const {crc32}=await import('../src/lib/adapters/archive.ts');
 chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);
 const file=new File([png.subarray(0,33),chunk,png.subarray(33)],'large.bin');
 assert.equal((await inspectFile(file)).width,128);
 chunk.writeUInt32BE(0xffffffff);
 await assert.rejects(inspectFile(new File([png.subarray(0,33),chunk,png.subarray(33)],'large.png')),/corrupt|truncated/i);
});
