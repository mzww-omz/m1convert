import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage();page.setDefaultTimeout(45000);const errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
await page.addInitScript(()=>{
 const Native=Worker;window.checks=[];window.active=0;
 window.Worker=class extends Native {
  ended=false;record;
  constructor(...args){super(...args);window.active++;this.addEventListener('message',e=>{if(!this.record)return;const now=performance.now();if(e.data.type==='stage')this.record.stages.push({stage:e.data.stage,ms:now-this.record.start});if(e.data.type==='analyzed'){this.record.ms=now-this.record.start;this.record.outputs=e.data.analysis.outputs;}});}
  postMessage(data,...args){if(data.type==='inspect'){this.record={name:data.file.name,start:performance.now(),stages:[],known:data.verifiedOutputs??{}};window.checks.push(this.record);}super.postMessage(data,...args);}
  terminate(){if(!this.ended){window.active--;this.ended=true;}super.terminate();}
 };
});
try {
 await page.goto(process.env.TEST_URL||'http://localhost:5173');await page.locator('[data-ready=true]').waitFor();
 const files=['tests/fixtures/swatch.png','tests/fixtures/swatch.png','tests/fixtures/swatch.png','tests/fixtures/audio/music.wav','tests/fixtures/audio/music.wav','tests/fixtures/audio/music.wav','tests/fixtures/audio/music.mp3','tests/fixtures/audio/music.mp3'];
 for(let i=0;i<files.length;i++) {
  const start=requests.length;
  await page.locator('input[type=file]').setInputFiles(files[i]);await page.waitForFunction(n=>window.checks.length===n&&typeof window.checks[n-1].ms==='number',i+1);
  await page.evaluate(({i,network})=>window.checks[i].network=network,{i,network:requests.slice(start)});
  assert.equal(await page.evaluate(()=>window.active),0);
 }
 const checks=await page.evaluate(()=>window.checks),result={version:browser.version(),checks};
 await mkdir('artifacts/checking',{recursive:true});await writeFile(`artifacts/checking/${process.env.BENCH_LABEL||'result'}.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify(checks.map(({name,ms,stages,known})=>({name,ms:Math.round(ms),stages,known})),null,2));
 if(process.env.EXPECT_CACHE!=='0') {
  assert.ok(checks[1].known.image.includes('ICO'));assert.ok(checks[4].known.audio.includes('MP3'));
  // A warmed WAV must not re-initialize WASM or import the native audio bridge to probe encoders again.
  assert.deepEqual(checks[3].outputs,checks[4].outputs);assert.deepEqual(checks[0].outputs,checks[1].outputs);
  assert.ok(!checks[4].network.some(url=>url.includes('/vendor/')),'warm WAV analysis must not load WASM again');
  assert.ok(checks[4].ms<checks[3].ms,'warm WAV analysis should be faster than first audio codec discovery');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
