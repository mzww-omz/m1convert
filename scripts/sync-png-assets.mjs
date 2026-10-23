import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir='static/vendor/png-3.1.1',pkg='node_modules/@jsquash/png',manifest={};
await mkdir(`${dir}/codec/pkg`,{recursive:true});await mkdir('static/legal',{recursive:true});
for(const name of ['encode.js','codec/pkg/squoosh_png.js','codec/pkg/squoosh_png_bg.wasm']) {
 await copyFile(`${pkg}/${name}`,`${dir}/${name}`);
 const bytes=await readFile(`${dir}/${name}`);manifest[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
await writeFile(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
await copyFile(`${pkg}/LICENSE`,'static/legal/PNG-LICENSE');
await copyFile(`${pkg}/codec/LICENSE.codec.md`,'static/legal/PNG-CODEC-LICENSE');
