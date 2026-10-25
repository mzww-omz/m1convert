import assert from 'node:assert/strict';
import {readFile,stat,readdir} from 'node:fs/promises';
const html=await readFile('build/index.html','utf8');
assert.match(html,/<title>Convert/);assert.match(html,/Drop file/);
for(const name of ['vendor/png-3.1.1/codec/pkg/squoosh_png_bg.wasm','vendor/libav-6.10.9.0/libav-6.10.9.0-obsolete.wasm.wasm','legal/NOTICE.txt','legal/PNG-LICENSE','legal/PNG-CODEC-LICENSE','legal/libav-6.10.9.0/libav.js.tar.xz',
  'vendor/libarchive/libarchive.wasm','vendor/libarchive/worker-bundle.js','legal/HEIF-LICENSE','legal/JXL-LICENSE','legal/ZSTD-LICENSE'])
 assert.ok((await stat('build/'+name)).size>100);
const workerAssets=await readdir('build/_app/immutable/workers/assets');
assert.ok(workerAssets.some(name=>/^jxl_dec-.*\.wasm$/.test(name)),'JXL decoder WASM must be locally bundled');
assert.ok(workerAssets.some(name=>/^jxl_enc-.*\.wasm$/.test(name)),'JXL encoder WASM must be locally bundled');
console.log('PASS prerendered static index, local JXL/libarchive/audio/PNG codecs and license notices');
