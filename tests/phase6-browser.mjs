import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {decodePcm} from '../src/lib/adapters/pcm.ts';
import {decodeTiff} from '../src/lib/adapters/tiff.ts';
import {inspectFile} from '../src/lib/image-format.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage(),errors=[],external=[],uploads=[],results=[];
page.setDefaultTimeout(45000);
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.method()!=='GET')uploads.push(r.url());if(/^https?:/.test(r.url())&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());});
await page.addInitScript(()=>{
 const W=Worker;window.workers=0;window.stages=[];
 window.Worker=class extends W {ended=false;constructor(...args){super(...args);window.workers++;this.addEventListener('message',e=>{if(e.data.type==='stage')window.stages.push(e.data.stage);});}terminate(){if(!this.ended){this.ended=true;window.workers--;}super.terminate();}};
 window.urls=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=b=>{const u=create(b);window.urls.add(u);return u;};URL.revokeObjectURL=u=>{window.urls.delete(u);revoke(u);};
});
const output=()=>page.getByRole('combobox',{name:'Output format'});
const settled=()=>page.waitForFunction(()=>document.querySelector('[data-phase=details]')&&!document.querySelector('.surface-content.hidden')&&getComputedStyle(document.querySelector('.surface-content')).opacity==='1');
const upload=async name=>{await page.locator('input[type=file]').setInputFiles({name,mimeType:'',buffer:await readFile(new URL('./fixtures/'+name,import.meta.url))});await output().waitFor();await settled();await page.waitForFunction(()=>!document.querySelector('select').disabled);};
const convert=async format=>{
 await output().selectOption(format);await page.getByRole('button',{name:'Convert',exact:true}).click();
 await Promise.race([page.getByRole('button',{name:'Download',exact:true}).waitFor(),page.locator('.error-message').waitFor().then(async()=>{throw new Error(await page.locator('.error-message').innerText());})]);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();const download=await pending,bytes=await readFile(await download.path());
 assert.equal(await page.evaluate(()=>window.workers),0);
 return {bytes,name:download.suggestedFilename()};
};
const again=async()=>{await page.getByRole('button',{name:'Convert Again'}).click();await settled();};
try {
 await mkdir('artifacts/phase6',{recursive:true});await page.goto(process.env.TEST_URL||'http://localhost:5173');await page.locator('[data-ready=true]').waitFor();
 for(const name of ['phase6-packbits.tiff','phase6-gray16le.tiff','phase6-gray16be.tiff']) {
  await upload(name);assert.match(await page.locator('#conversion-note').innerText(),/8-bit/);
  const expected=decodeTiff(await readFile(new URL('./fixtures/'+name,import.meta.url)));
  const choices=await output().locator('option').evaluateAll(options=>options.map(o=>o.value));
  for(const format of choices) {
   const {bytes,name:saved}=await convert(format),info=await inspectFile(new File([bytes],saved));assert.equal(info.format,format);
   await writeFile(`artifacts/phase6/${name}-${saved}`,bytes);
   if(['PNG','BMP','TIFF'].includes(format)) {
    const pixels=format==='TIFF'?[...decodeTiff(bytes).data]:await page.evaluate(async ({bytes,format})=>{const b=await createImageBitmap(new Blob([Uint8Array.from(bytes)],{type:format==='PNG'?'image/png':'image/bmp'}));const c=new OffscreenCanvas(b.width,b.height),ctx=c.getContext('2d');ctx.drawImage(b,0,0);b.close();return [...ctx.getImageData(0,0,c.width,c.height).data];},{bytes:[...bytes],format});
    assert.deepEqual(pixels,[...expected.data]);
   }
   results.push(`${name}→${format}`);await again();
  }
 }
 for(const ext of ['wav','aiff','mp3','flac','ogg','opus','aac','m4a']) {
  await upload('audio/music.'+ext);
  await output().selectOption('AIFF');assert.equal(await page.getByRole('combobox',{name:'Bitrate',exact:true}).count(),0);
  const {bytes,name}=await convert('AIFF'),decoded=decodePcm(bytes,'AIFF');
  assert.equal(decoded.channels,2);assert.equal(decoded.sampleRate,48000);assert.ok(decoded.samples.some(v=>Math.abs(v)>.01));
  assert.ok(Math.abs(decoded.samples.length/2/48000-2)<.15);
  await writeFile(`artifacts/phase6/${ext}-${name}`,bytes);results.push(`${ext}→AIFF`);await again();
 }
 // Terminate an actual AIFF conversion while PCM resampling is running; retry unchanged settings.
 const {encodeWav}=await import('../src/lib/adapters/pcm.ts');
 const large=encodeWav({sampleRate:48000,channels:1,samples:Float32Array.from({length:1000000},(_,i)=>Math.sin(i*.1))});
 await page.locator('input[type=file]').setInputFiles({name:'large.wav',mimeType:'audio/wav',buffer:Buffer.from(large)});await settled();
 await output().selectOption('AIFF');await page.getByRole('combobox',{name:'Sample rate',exact:true}).selectOption('96000');
 await page.evaluate(()=>window.stages=[]);await page.getByRole('button',{name:'Convert',exact:true}).click();await page.waitForFunction(()=>window.workers===1&&window.stages.includes('decoding'));
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await settled();assert.equal(await page.evaluate(()=>window.workers),0);
 assert.equal(await output().inputValue(),'AIFF');assert.equal(await page.evaluate(()=>window.urls.size),0);
 const retry=await convert('AIFF');assert.equal(decodePcm(retry.bytes,'AIFF').sampleRate,96000);await again();
 await page.getByRole('button',{name:'Remove file'}).click();await page.locator('[data-phase=upload]').waitFor();
 assert.equal(await page.evaluate(()=>window.urls.size),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(uploads,[]);
 await writeFile('artifacts/phase6/results.json',JSON.stringify({results,errors,external,uploads},null,2));
 console.log(`PASS ${results.length} Phase 6 real conversions, TIFF pixel equality, AIFF decode/options/cancel/retry, Worker/URL release, no external traffic`);
} finally {await browser.close();}
