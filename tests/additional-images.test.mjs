import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectFile } from '../src/lib/image-format.ts';
import { encodeTiff, decodeTiff, tiffInfo } from '../src/lib/adapters/tiff.ts';
const pixel={width:2,height:2,data:new Uint8ClampedArray([255,0,0,255,0,0,255,128,0,255,0,0,1,2,3,255])};
test('baseline TIFF round trips exact RGBA and rejects compression, multiple pages and offset overflow', async () => {
  const b=encodeTiff(pixel); assert.deepEqual(decodeTiff(b),pixel);
  const info=await inspectFile(new File([b],'rgba.tiff',{type:'image/tiff'})); assert.equal(info.width,2); assert.equal(info.height,2);
  for(const mutate of [
    (b,v)=>v.setUint32(4,0xffffffff,true),
    (b,v)=>v.setUint32(10+13*12,8,true),
    (b,v)=>{ for(let p=10;p<10+13*12;p+=12) if(v.getUint16(p,true)===259) v.setUint16(p+8,5,true); },
    (b,v)=>{ for(let p=10;p<10+13*12;p+=12) if(v.getUint16(p,true)===273) v.setUint32(p+8,0xffffffff,true); }
  ]) { const bad=b.slice(); mutate(bad,new DataView(bad.buffer)); assert.throws(()=>tiffInfo(bad)); }
  assert.throws(()=>decodeTiff(b.subarray(0,-1)));
  const profiled=b.slice();new DataView(profiled.buffer).setUint16(10+12*12,34675,true);
  assert.throws(()=>tiffInfo(profiled),/ICC|profile/i);
});
test('independent RGB TIFF and single-frame GIF fixtures pass structure and dimensions', async () => {
  for(const ext of ['tiff','gif']) {
    const bytes=await readFile(new URL('./fixtures/swatch.'+ext,import.meta.url));
    const info=await inspectFile(new File([bytes],'swatch.'+ext,{type:'image/'+ext}));
    assert.equal(info.width,128); assert.equal(info.height,80);
    if(ext==='tiff') assert.equal(decodeTiff(bytes).data.length,128*80*4);
  }
});
test('animated GIF, truncated subblocks and invalid logical screen bounds are rejected', async () => {
  const bytes=await readFile(new URL('./fixtures/swatch.gif',import.meta.url));
  await assert.rejects(inspectFile(new File([bytes.subarray(0,-1)],'bad.gif')),/GIF|corrupt|truncat/i);
  const animated=await readFile(new URL('./fixtures/animated.gif',import.meta.url));
  await assert.rejects(inspectFile(new File([animated],'animated.gif')),/animat/i);
  const bad=bytes.slice(); bad[6]=1;bad[7]=0;
  await assert.rejects(inspectFile(new File([bad],'bad.gif')),/GIF|dimension/i);
});
