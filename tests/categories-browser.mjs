import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {archiveCodec,decodeZip,encodeTar} from '../src/lib/adapters/archive.ts';
import {decodePcm,encodeWav} from '../src/lib/adapters/pcm.ts';
import {detectFormat} from '../src/lib/registry.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],external=[],uploads=[];
page.setDefaultTimeout(45000);
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/^https?:/.test(r.url())&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());if(r.method()!=='GET')uploads.push(r.url());});
await page.addInitScript(()=>{
  const W=Worker; window.activeWorkers=0;
  window.Worker=class extends W { ended=false;constructor(...args){super(...args);window.activeWorkers++;window.workerStage='';this.addEventListener('message',e=>{if(e.data.type==='stage')window.workerStage=e.data.stage;});}terminate(){if(!this.ended){this.ended=true;window.activeWorkers--;}super.terminate();} };
  window.liveUrls=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=b=>{const u=create(b);window.liveUrls.add(u);return u;}; URL.revokeObjectURL=u=>{window.liveUrls.delete(u);revoke(u);};
});
const fixture=async name=>({name,mimeType:'',buffer:await readFile(new URL('./fixtures/'+name,import.meta.url))});
const upload=async value=>{await page.locator('input[type=file]').setInputFiles(value);await page.getByRole('heading',{name:(Array.isArray(value)?value[0]:value).name,exact:true}).waitFor();await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Convert'));return b&&!b.disabled&&!document.querySelector('.surface-content.hidden');});};
const output=()=>page.getByRole('combobox',{name:'Output format'});
const convert=async()=>{await page.getByRole('button',{name:'Convert',exact:true}).click();await Promise.race([page.getByRole('button',{name:'Download',exact:true}).waitFor(),page.locator('.error-message').waitFor().then(async()=>{throw new Error(await page.locator('.error-message').innerText());})]);};
const download=async()=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();const d=await pending;return {name:d.suggestedFilename(),bytes:await readFile(await d.path())};};
const again=async()=>{await page.getByRole('button',{name:'Convert Again'}).click();await output().waitFor();await page.waitForFunction(()=>document.querySelector('[data-phase=details]')&&!document.querySelector('.surface-content.hidden')&&getComputedStyle(document.querySelector('.surface-content')).opacity==='1');};
const paths=new Set();await mkdir('artifacts/continuous',{recursive:true});
try {
  await page.goto(process.env.TEST_URL||'http://localhost:5173');await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-surface]').evaluate(el=>window.originalSurface=el);
  for(const name of ['stored.zip','deflated.zip','sample.tar','sample.tar.gz','hello.txt.gz']) {
    const input=await fixture(name);await upload(input);
    const choices=await output().locator('option').allTextContents();assert.deepEqual(new Set(choices),new Set(['ZIP','TAR','TAR.GZ','GZIP']));
    for(const format of choices) {
      console.log('ARCHIVE',name,format);
      await output().selectOption(format);
      if(format==='ZIP') await page.getByRole('combobox',{name:'Compression',exact:true}).selectOption(name==='stored.zip'?'store':'deflate');
      await convert();const saved=await download();
      assert.ok(saved.bytes.length); const check=await archiveCodec.inspect(new File([saved.bytes],saved.name),()=>{});
      assert.equal(check.info.format,format);
      paths.add(`${name.endsWith('.tar.gz')?'TAR.GZ':detectFormat(input.buffer).id}→${format}`);
      await writeFile(`artifacts/continuous/${name.replaceAll('.','-')}-to-${format.replaceAll('.','-')}.${format==='TAR.GZ'?'tar.gz':format.toLowerCase()==='gzip'?'gz':format.toLowerCase()}`,saved.bytes);
      assert.equal(await page.evaluate(()=>window.activeWorkers),0);await again();
    }
  }
  for(const name of ['tone.wav','tone.aiff']) {
    await upload(await fixture(name));assert.ok((await output().locator('option').allTextContents()).includes('WAV'));
    assert.equal(await page.getByRole('combobox',{name:'Compression',exact:true}).count(),0);
    for(const [rate,channels] of [['0','0'],['16000','1'],['44100','2']]) {
      await page.getByRole('combobox',{name:'Sample rate',exact:true}).selectOption(rate);await page.getByRole('combobox',{name:'Channels',exact:true}).selectOption(channels);
      console.log('AUDIO',name,rate,channels,await page.getByRole('combobox',{name:'Sample rate',exact:true}).inputValue());
      await convert();const saved=await download(),pcm=decodePcm(saved.bytes,'WAV');
      assert.equal(pcm.sampleRate,+rate||48000);assert.equal(pcm.channels,+channels||2);
      await writeFile(`artifacts/continuous/${name}-converted-${rate}-${channels}.wav`,saved.bytes);await again();
      assert.equal(await page.getByRole('combobox',{name:'Sample rate',exact:true}).inputValue(),rate);
    }
    await page.screenshot({path:`artifacts/continuous/${name}-desktop.png`});
    await page.setViewportSize({width:320,height:740});await page.waitForTimeout(500);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`artifacts/continuous/${name}-mobile.png`});await page.setViewportSize({width:1280,height:900});
  }
  await upload([await fixture('tone.wav'),await fixture('tone.aiff')]);
  await page.getByRole('combobox',{name:'Sample rate',exact:true}).selectOption('16000');await convert();const batch=await download();
  assert.equal(batch.name,'converted-audio.zip');const entries=await decodeZip(batch.bytes);assert.equal(entries.length,2);
  for(const e of entries) assert.equal(decodePcm(e.data,'WAV').sampleRate,16000);
  await again();
  // Cancel actual native compression work, not a mocked timer or a queued UI transition.
  const random=new Uint8Array(24*1024**2);let seed=123456789;
  for(let i=0;i<random.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;random[i]=seed&255;}
  await upload({name:'large.tar',mimeType:'application/x-tar',buffer:Buffer.from(encodeTar([{name:'random.bin',data:random,directory:false,mtime:0}]))});
  await output().selectOption('ZIP');await page.getByRole('button',{name:'Convert',exact:true}).click();
  await page.waitForFunction(()=>window.workerStage==='encoding'&&window.activeWorkers===1);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await output().waitFor();
  assert.equal(await page.evaluate(()=>window.activeWorkers),0);assert.equal(await page.evaluate(()=>window.liveUrls.size),0);
  // Large actual resampling job gives Cancel real work to terminate, not a mocked delay.
  const big=encodeWav({sampleRate:48000,channels:1,samples:Float32Array.from({length:1000000},(_,i)=>Math.sin(i*.1))});
  await upload({name:'large.wav',mimeType:'audio/wav',buffer:Buffer.from(big)});
  await page.getByRole('combobox',{name:'Sample rate',exact:true}).selectOption('96000');
  await page.getByRole('button',{name:'Convert',exact:true}).click();await page.waitForFunction(()=>window.workerStage==='decoding'&&window.activeWorkers===1);await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await output().waitFor();assert.equal(await page.getByRole('combobox',{name:'Sample rate',exact:true}).inputValue(),'96000');
  assert.equal(await page.evaluate(()=>window.activeWorkers),0);assert.equal(await page.evaluate(()=>window.liveUrls.size),0);
  for(const [name,buffer,message] of [
    ['fake.mp3',(await fixture('tone.wav')).buffer,/not supported|conversion is not supported|extension/i],
    ['bad.zip',Buffer.from('PK\x03\x04garbage'),/ZIP|archive|corrupt/i],
    ['animated.gif',(await fixture('animated.gif')).buffer,/animat/i]
  ]) {
    await page.locator('input[type=file]').setInputFiles({name,mimeType:'',buffer});
    await page.locator('#conversion-note').filter({hasText:message}).waitFor();assert.ok(await output().isDisabled());
    assert.equal(await page.evaluate(()=>window.activeWorkers),0);
  }
  await page.getByRole('button',{name:'Remove file'}).click();await page.locator('[data-phase=upload]').waitFor();
  assert.ok(await page.evaluate(()=>document.querySelector('[data-surface]')===window.originalSurface));
  assert.equal(await page.evaluate(()=>window.liveUrls.size),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(uploads,[]);
  await writeFile('artifacts/continuous/archive-paths.json',JSON.stringify([...paths],null,2));
  console.log(`PASS ${paths.size} archive routes, 2 audio routes × 3 settings, audio batch ZIP, real cancellation, errors, desktop/mobile, DOM identity, worker/URL cleanup; no uploads/external requests`);
} finally { if(errors.length)console.error(errors);await browser.close(); }
