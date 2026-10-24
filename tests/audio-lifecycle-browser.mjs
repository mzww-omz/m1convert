import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage();page.setDefaultTimeout(45000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 const Native=Worker;window.active=0;window.stage=null;window.liveUrls=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=b=>{const u=create(b);window.liveUrls.add(u);return u;};URL.revokeObjectURL=u=>{window.liveUrls.delete(u);revoke(u);};
 window.Worker=class extends Native {ended=false;constructor(...args){super(...args);window.active++;this.addEventListener('message',e=>{if(e.data.type==='stage')window.stage=e.data;});}terminate(){if(!this.ended){this.ended=true;window.active--;}super.terminate();}};
});
const base=process.env.TEST_URL||'http://localhost:5173',select=()=>page.getByRole('combobox',{name:'Output format'});
const ready=()=>page.waitForFunction(()=>{const c=document.querySelector('.surface-content'),s=document.querySelector('select');return c&&!c.classList.contains('hidden')&&getComputedStyle(c).opacity==='1'&&s&&!s.disabled;});
const upload=async path=>{await page.locator('input[type=file]').setInputFiles(path);await page.getByRole('heading',{name:path.split('/').at(-1),exact:true}).waitFor();await ready();const settings=page.getByRole('button',{name:'Settings',exact:true});if(await settings.getAttribute('aria-expanded')!=='true')await settings.click();};
const cancel=async()=>{await page.getByRole('button',{name:'Cancel',exact:true}).click();await ready();assert.equal(await page.evaluate(()=>window.active),0);assert.equal(await page.evaluate(()=>window.liveUrls.size),0);};
try {
 await page.goto(base);await page.locator('[data-ready=true]').waitFor();await upload('tests/fixtures/audio/music.wav');await select().selectOption('MP3');
 let release,arrived;const blocked=new Promise(r=>release=r),seen=new Promise(r=>arrived=r);
 await page.route('**/vendor/**/*.wasm',async route=>{arrived();await blocked;await route.abort().catch(()=>{});});
 await page.getByRole('button',{name:'Convert',exact:true}).click();await seen;await cancel();assert.equal(await select().inputValue(),'MP3');release();await page.unrouteAll({behavior:'wait'});
 await page.waitForTimeout(300);assert.equal(await page.getByRole('button',{name:'Download',exact:true}).count(),0);
 await mkdir('artifacts/audio',{recursive:true});const heavy='artifacts/audio/heavy.flac';
 const generated=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','anoisesrc=duration=60:sample_rate=48000:amplitude=0.2','-ac','2','-c:a','flac',heavy]);assert.equal(generated.status,0,generated.stderr.toString());
 await upload(heavy);await select().selectOption('MP3');await page.getByRole('combobox',{name:'Bitrate',exact:true}).selectOption('128');
 await page.getByRole('button',{name:'Convert',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).waitFor();
 await page.waitForFunction(()=>window.stage?.stage==='encoding'&&window.stage.percent>5&&window.stage.percent<90&&window.active===1);
 await cancel();assert.equal(await page.getByRole('combobox',{name:'Bitrate',exact:true}).inputValue(),'128');await page.waitForTimeout(400);assert.equal(await page.getByRole('button',{name:'Download',exact:true}).count(),0);
 // A runtime load failure invalidates remembered capabilities; the next analysis re-probes.
 await page.route('**/vendor/**/*.wasm',route=>route.abort());await upload('tests/fixtures/audio/music.wav');
 await select().selectOption('MP3');await page.getByRole('button',{name:'Convert',exact:true}).click();await page.locator('.error-message').waitFor();
 await page.getByRole('button',{name:'Back to details',exact:true}).click();await ready();await upload('tests/fixtures/audio/music.wav');
 await page.waitForFunction(()=>document.querySelector('select')&&!document.querySelector('select').disabled&&![...document.querySelector('select').options].some(o=>o.value==='MP3'));
 const limited=await select().locator('option').evaluateAll(opts=>opts.map(o=>o.value));assert.ok(limited.includes('WAV'));assert.ok(!limited.includes('MP3')&&!limited.includes('FLAC'));
 await select().selectOption('WAV');await page.getByRole('button',{name:'Convert',exact:true}).click();await page.getByRole('button',{name:'Download',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.active),0);await page.unrouteAll();
 await page.getByRole('button',{name:'New File'}).click();await page.locator('[data-phase=upload]').waitFor();assert.equal(await page.evaluate(()=>window.liveUrls.size),0);
 await upload('tests/fixtures/audio/music.wav');assert.ok((await select().locator('option').evaluateAll(opts=>opts.map(o=>o.value))).includes('MP3'),'failed probes must be retried after WASM becomes available');
 await page.getByRole('button',{name:'Remove file'}).click();await page.locator('[data-phase=upload]').waitFor();
 // Browser capability simulation, not a claim that Firefox/Safari was executed.
 const nativeMissing=await browser.newPage();await nativeMissing.addInitScript(()=>{
  const Native=Worker;window.Worker=class extends Native{constructor(url,options){const wrapper=URL.createObjectURL(new Blob([`import ${JSON.stringify(String(url))}; self.AudioEncoder=undefined; self.AudioDecoder=undefined;`],{type:'text/javascript'}));super(wrapper,options);URL.revokeObjectURL(wrapper);}};
 });await nativeMissing.goto(base);await nativeMissing.locator('[data-ready=true]').waitFor();await nativeMissing.locator('input[type=file]').setInputFiles('tests/fixtures/audio/music.wav');
 await nativeMissing.waitForFunction(()=>document.querySelector('select')&&!document.querySelector('select').disabled);
 const choices=await nativeMissing.getByRole('combobox',{name:'Output format'}).locator('option').evaluateAll(opts=>opts.map(o=>o.value));assert.ok(choices.includes('MP3')&&choices.includes('OPUS'));assert.ok(!choices.includes('AAC')&&!choices.includes('M4A'));
 await nativeMissing.locator('input[type=file]').setInputFiles('tests/fixtures/audio/music.aac');await nativeMissing.locator('#conversion-note').filter({hasText:/cannot decode|codec/i}).waitFor();await nativeMissing.close();assert.deepEqual(errors,[]);
 console.log('PASS Cancel during blocked WASM initialization and measured native-worker MP3 encoding; settings/stale-result/URL cleanup, missing-WASM PCM fallback, native-AAC absence hides outputs and rejects input');
}finally{await browser.close();}
