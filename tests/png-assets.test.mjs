import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {init,default as encode} from '@jsquash/png/encode.js';
import {decode} from '@jsquash/png';
test('pinned single-thread PNG WASM is genuine, self-hosted and has matching notices',async()=>{
 const base=new URL('../static/vendor/png-3.1.1/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',base)));
 const bytes=await readFile(new URL('squoosh_png_bg.wasm',base));
 assert.equal(bytes.length,manifest['squoosh_png_bg.wasm'].bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest['squoosh_png_bg.wasm'].sha256);
 assert.deepEqual(bytes,await readFile(new URL('../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm',import.meta.url)));
 await init(bytes);const data=Uint8ClampedArray.from([255,0,0,255,0,0,255,128]);
 const encoded=await encode({data,width:2,height:1,colorSpace:'srgb'});
 const image=await decode(encoded);assert.equal(image.width,2);assert.deepEqual(image.data,data);
 for(const name of ['PNG-LICENSE','PNG-CODEC-LICENSE'])assert.ok((await readFile(new URL('../static/legal/'+name,import.meta.url),'utf8')).length>1000);
});
