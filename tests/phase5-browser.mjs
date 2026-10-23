import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],external=[],uploads=[],wasmRequests=[],timings=[];
let initialResources=[];
page.setDefaultTimeout(45000);
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.method()!=='GET')uploads.push(r.url());if(/^https?:/.test(r.url())&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());if(/\.wasm(?:\?|$)/.test(r.url()))wasmRequests.push(r.url());});
await page.addInitScript(()=>{
 window.engineMode='normal';window.workers=0;window.codecResults=[];window.codecAnalyses=[];window.liveUrls=new Set();
 const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=b=>{const u=create(b);window.liveUrls.add(u);return u;};URL.revokeObjectURL=u=>{window.liveUrls.delete(u);revoke(u);};
 const W=Worker;
 window.Worker=class extends W {
  ended=false;
  constructor(url,options) {
   const mode=window.engineMode;
   const script=`const queued=[];self.onmessage=e=>queued.push(e);const mode=${JSON.stringify(mode)};const encode=OffscreenCanvas.prototype.convertToBlob;
    OffscreenCanvas.prototype.convertToBlob=function(q){
     if(q?.type==='image/png'){
      if(mode==='unsupported')return Promise.reject(new DOMException('Native PNG unavailable','NotSupportedError'));
      if(mode==='resource')return Promise.reject(new RangeError('Safety test: native allocation failed'));
      if(mode==='wrong-dimensions'){const tiny=new OffscreenCanvas(1,1);tiny.getContext('2d');return encode.call(tiny,q);}
     }
     return encode.call(this,q);
    };await import(${JSON.stringify(String(url))});for(const e of queued)self.onmessage(e);`;
   const shim=URL.createObjectURL(new Blob([script],{type:'text/javascript'}));
   super(shim,options);this.shim=shim;window.workers++;
   this.addEventListener('message',e=>{if(e.data.type==='converted')window.codecResults.push({...e.data.result.engines,workerMs:performance.now()-this.started});if(e.data.type==='analyzed')window.codecAnalyses.push(e.data.analysis);});
  }
  postMessage(message,...args){if(message.type==='convert')this.started=performance.now();super.postMessage(message,...args);}
  terminate(){if(!this.ended){this.ended=true;window.workers--;URL.revokeObjectURL(this.shim);}super.terminate();}
 };
});
const fixture=async name=>({name,mimeType:'',buffer:await readFile(new URL('./fixtures/'+name,import.meta.url))});
const output=()=>page.getByRole('combobox',{name:'Output format'});
const settled=()=>page.waitForFunction(()=>document.querySelector('[data-phase=details]')&&!document.querySelector('.surface-content.hidden')&&getComputedStyle(document.querySelector('.surface-content')).opacity==='1');
const upload=async input=>{await page.evaluate(()=>window.engineMode='normal');await page.locator('input[type=file]').setInputFiles(input);await output().waitFor();await page.waitForFunction(()=>{const s=document.querySelector('select');return s&&!s.disabled;});await settled();};
const start=async mode=>{await page.evaluate(mode=>window.engineMode=mode,mode);await output().selectOption('PNG');await page.getByRole('button',{name:'Convert',exact:true}).click();};
const complete=async label=>{
 const t=performance.now();await page.getByRole('button',{name:'Download',exact:true}).waitFor();
 const promise=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();const d=await promise,bytes=await readFile(await d.path());
 const pixels=await page.evaluate(async bytes=>{const bitmap=await createImageBitmap(new Blob([Uint8Array.from(bytes)],{type:'image/png'}));const c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const pixel=(x,y)=>[...ctx.getImageData(x,y,1,1).data];return {width:c.width,height:c.height,red:pixel(10,10),transparent:pixel(100,60)};},[...bytes]);
 assert.equal(pixels.width,128);assert.equal(pixels.height,80);assert.ok(pixels.red[0]>180);assert.equal(pixels.transparent[3],0);
 const result=await page.evaluate(()=>window.codecResults.at(-1));timings.push({label,waitMs:performance.now()-t,bytes:bytes.length,...result});
 assert.equal(await page.evaluate(()=>window.workers),0);
 await page.getByRole('button',{name:'Convert Again'}).click();await settled();return result;
};
try {
 await page.goto(process.env.TEST_URL||'http://localhost:5173');await page.locator('[data-ready=true]').waitFor();
 await page.locator('[data-surface]').evaluate(el=>window.originalSurface=el);
 assert.equal(await page.evaluate(()=>crossOriginIsolated),false,'Baseline test must work without COOP/COEP');assert.equal(wasmRequests.length,0,'No initial WASM request');
 initialResources=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({url:r.name,bytes:r.encodedBodySize})));
 await upload(await fixture('swatch.png'));
 const analysis=await page.evaluate(()=>window.codecAnalyses.at(-1));
 assert.ok(analysis.codecEngines.some(e=>e.id==='wasm-png'));assert.equal(analysis.environment.sharedMemory,false);
 assert.equal(wasmRequests.length,0,'Normal image analysis must not initialize either WASM engine');
 await start('normal');assert.equal((await complete('native PNG')).encoder,'native-canvas');assert.equal(wasmRequests.length,0);
 await start('unsupported');const fallback=await complete('PNG WASM fallback');assert.equal(fallback.encoder,'wasm-png');assert.deepEqual(fallback.fallbackFrom,['native-canvas']);
 assert.ok(wasmRequests.some(u=>u.includes('/vendor/png-3.1.1/')));assert.ok(!wasmRequests.some(u=>u.includes('libav')));
 await start('wrong-dimensions');const verified=await complete('Wrong native output dimensions');assert.equal(verified.encoder,'wasm-png');
 // Allocation/resource errors must not trigger an additional expensive engine.
 const before=wasmRequests.length;await start('resource');await page.locator('.error-message').filter({hasText:/native allocation failed/}).waitFor();assert.equal(wasmRequests.length,before);
 await page.getByRole('button',{name:'Back to details'}).click();await settled();
 // Missing static assets produce a real, recoverable UI error rather than fake output.
 await page.route('**/vendor/png-3.1.1/codec/pkg/*.wasm',route=>route.abort());await start('unsupported');
 await page.locator('.error-message').filter({hasText:/PNG WASM could not load/}).waitFor();assert.equal(await page.evaluate(()=>window.workers),0);
 await page.unroute('**/vendor/png-3.1.1/codec/pkg/*.wasm');await page.getByRole('button',{name:'Back to details'}).click();await settled();
 // Cancel while the actual optional WASM request is pending, not a synthetic UI timer.
 let release,requested;const pending=new Promise(r=>release=r),seen=new Promise(r=>requested=r);
 await page.route('**/vendor/png-3.1.1/codec/pkg/*.wasm',async route=>{requested();await pending;await route.abort().catch(()=>{});});
 await start('unsupported');await seen;await page.getByRole('button',{name:'Cancel',exact:true}).click();await settled();
 assert.equal(await page.evaluate(()=>window.workers),0);assert.equal(await output().inputValue(),'PNG');assert.equal(await page.evaluate(()=>window.liveUrls.size),1);
 release();await page.unroute('**/vendor/png-3.1.1/codec/pkg/*.wasm');
 await start('unsupported');assert.equal((await complete('Retry after cancellation')).encoder,'wasm-png');
 // Invalid source structures must never reach the fallback loader.
 const count=wasmRequests.length;await page.evaluate(()=>window.engineMode='unsupported');
 await page.locator('input[type=file]').setInputFiles({name:'corrupt.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])});
 await page.locator('#conversion-note').filter({hasText:/corrupt|truncated/}).waitFor();assert.ok(await output().isDisabled());assert.equal(wasmRequests.length,count);
 // Real audio uses the same registry/context with independent decoder and encoder IDs.
 await upload(await fixture('audio/music.wav'));
 for(const [format,expected] of [['MP3','wasm-libav-encode'],['M4A','webcodecs-aac-encode']]) {
  if(!(await output().locator(`option[value="${format}"]`).count()))continue;
  await output().selectOption(format);await page.getByRole('button',{name:'Convert',exact:true}).click();await page.getByRole('button',{name:'Download',exact:true}).waitFor();
  const result=await page.evaluate(()=>window.codecResults.at(-1));assert.equal(result.decoder,'builtin-pcm-decode');assert.equal(result.encoder,expected);
  await page.getByRole('button',{name:'Convert Again'}).click();await settled();
 }
 await page.getByRole('button',{name:'Remove file'}).click();await page.locator('[data-phase=upload]').waitFor();
 assert.equal(await page.evaluate(()=>window.workers),0);assert.equal(await page.evaluate(()=>window.liveUrls.size),0);
 assert.ok(await page.evaluate(()=>document.querySelector('[data-surface]')===window.originalSurface));
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(uploads,[]);
 await mkdir('artifacts/phase5',{recursive:true});await writeFile('artifacts/phase5/results.json',JSON.stringify({version:browser.version(),initialResources,timings,wasmRequests},null,2));
 console.log('PASS Native / WebCodecs / two WASM codecs, genuine PNG fallback and verification, terminal errors, blocked load, real Cancel/retry, lazy assets, no isolation/threads, same surface, cleanup and no uploads');
} catch(error){console.error('UI',await page.locator('main').innerText());throw error;} finally {await browser.close();}
