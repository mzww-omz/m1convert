import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodeTiff,tiffInfo} from '../src/lib/adapters/tiff.ts';
test('independent Pillow PackBits RGB and 16-bit TIFFs have expected pixels',async()=>{
 for(const name of ['phase6-packbits','phase6-gray16le','phase6-gray16be']) {
  const bytes=await readFile(new URL(`./fixtures/${name}.tiff`,import.meta.url)),image=decodeTiff(bytes);
  assert.deepEqual(tiffInfo(bytes),{width:32,height:16});
  assert.deepEqual([...image.data.subarray(0,4)],name.includes('packbits')?[255,0,128,255]:[0,0,0,255]);
  assert.deepEqual([...image.data.subarray(16*4,17*4)],name.includes('packbits')?[0,255,64,255]:[132,132,132,255]);
 }
});
