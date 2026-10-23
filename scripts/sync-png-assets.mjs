import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir='static/vendor/png-3.1.1',name='squoosh_png_bg.wasm',pkg='node_modules/@jsquash/png';
await mkdir(dir,{recursive:true});await mkdir('static/legal',{recursive:true});
await copyFile(`${pkg}/codec/pkg/${name}`,`${dir}/${name}`);
const bytes=await readFile(`${dir}/${name}`);
await writeFile(`${dir}/manifest.json`,JSON.stringify({[name]:{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},null,2)+'\n');
await copyFile(`${pkg}/LICENSE`,'static/legal/PNG-LICENSE');
await copyFile(`${pkg}/codec/LICENSE.codec.md`,'static/legal/PNG-CODEC-LICENSE');
