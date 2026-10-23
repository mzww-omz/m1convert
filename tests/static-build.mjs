import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
const html=await readFile('build/index.html','utf8');
assert.match(html,/<title>Convert/);assert.match(html,/Drop file/);
for(const name of ['vendor/png-3.1.1/codec/pkg/squoosh_png_bg.wasm','vendor/libav-6.10.9.0/libav-6.10.9.0-obsolete.wasm.wasm','legal/NOTICE.txt','legal/PNG-LICENSE','legal/PNG-CODEC-LICENSE','legal/libav-6.10.9.0/libav.js.tar.xz'])
 assert.ok((await stat('build/'+name)).size>100);
console.log('PASS prerendered static index, both local WASM engines and redistribution/source notices');
