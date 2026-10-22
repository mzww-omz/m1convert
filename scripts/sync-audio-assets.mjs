import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const name='libav-6.10.9.0-obsolete',dir='static/vendor/libav-6.10.9.0';
await mkdir(dir,{recursive:true});
const manifest={};
for(const ext of ['mjs','wasm.mjs','wasm.wasm']) {
  const file=`${name}.${ext}`;await copyFile(`node_modules/@libav.js/variant-obsolete/dist/${file}`,`${dir}/${file}`);
  const bytes=await readFile(`${dir}/${file}`);manifest[file]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
await writeFile(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
