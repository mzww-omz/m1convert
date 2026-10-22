import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('self-hosted single-thread audio WASM matches pinned package, manifest and license/source delivery',async()=>{
 const base=new URL('../static/vendor/libav-6.10.9.0/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',base)));
 for(const [name,info] of Object.entries(manifest)) {
  const bytes=await readFile(new URL(name,base));assert.equal(bytes.length,info.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),info.sha256);
  assert.deepEqual(bytes,await readFile(new URL('../node_modules/@libav.js/variant-obsolete/dist/'+name,import.meta.url)));
 }
 const notice=await readFile(new URL('../static/legal/NOTICE.txt',import.meta.url),'utf8');assert.match(notice,/LGPL/);assert.match(notice,/replace\/relink/);
 for(const name of ['libav.js.tar.xz','ffmpeg-9.0.tar.xz','opus-1.6.1.tar.gz','libvorbis-1.3.7.tar.xz','libogg-1.3.6.tar.xz','lame-3.100.tar.gz']) assert.ok((await readFile(new URL('../static/legal/libav-6.10.9.0/'+name,import.meta.url))).length>1000);
});
