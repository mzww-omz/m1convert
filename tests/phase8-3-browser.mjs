import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir,open,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const url=process.env.TEST_URL||'http://127.0.0.1:4181';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname),'Local preview required');
const engines=(process.env.BROWSERS||'chromium,firefox,webkit').split(',').map(s=>s.trim());
assert.ok(engines.length&&engines.every(s=>['chromium','firefox','webkit'].includes(s)),'Invalid BROWSERS');
const pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir='artifacts/phase8.3';await mkdir(dir,{recursive:true});
const payload=join(dir,'payload.bin'),zip=join(dir,'large.zip'),tgz=join(dir,'large.tar.gz');
const wav=join(dir,'long.wav'),size=68*1024**2,chunkBytes=1024**2;
const digest=createHash('sha256'),chunk=Buffer.allocUnsafe(chunkBytes);let seed=20261023;
for(let i=0;i<chunk.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;chunk[i]=seed&255;}
const source=await open(payload,'w');
try{for(let i=0;i<size/chunkBytes;i++){await source.write(chunk);digest.update(chunk);}}
finally{await source.close();}
const expected=digest.digest('hex');
const prepared=spawnSync('python3',['-c',`
import sys, zipfile, tarfile
source, out_zip, out_tar = sys.argv[1:]
with zipfile.ZipFile(out_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    z.write(source, arcname='payload.bin')
with tarfile.open(out_tar, 'w:gz', format=tarfile.USTAR_FORMAT) as t:
    t.add(source, arcname='payload.bin')
`,payload,zip,tgz],{encoding:'utf8'});
assert.equal(prepared.status,0,prepared.stderr);
for(const path of [zip,tgz])assert.ok((await stat(path)).size>32*1024**2,'Compressed input must exceed former 32 MiB cap');

const sampleRate=8000,seconds=600,total=sampleRate*seconds;
const audio=await open(wav,'w');
try{
 const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+total*2,4);
 header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);
 header.writeUInt16LE(1,22);header.writeUInt32LE(sampleRate,24);
 header.writeUInt32LE(sampleRate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
 header.write('data',36);header.writeUInt32LE(total*2,40);await audio.write(header);
 const block=Buffer.alloc(sampleRate*2);
 for(let i=0;i<sampleRate;i++)block.writeInt16LE((i%128)*128-8192,i*2);
 for(let i=0;i<seconds;i++)await audio.write(block);
}finally{await audio.close();}
function pcmHash(path){
 const result=spawnSync('ffmpeg',['-v','error','-i',path,'-f','s16le','-acodec','pcm_s16le','-f','hash','-hash','sha256','-'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return result.stdout.trim();
}
const expectedPcm=pcmHash(wav);
async function verifyTar(path){
 const file=await open(path,'r'),header=Buffer.alloc(512),buf=Buffer.allocUnsafe(chunkBytes),hash=createHash('sha256');
 try{
  assert.equal((await file.read(header,0,512,0)).bytesRead,512);
  assert.equal(header.toString('utf8',0,100).replace(/\0.*$/,''),'payload.bin');
  assert.equal(parseInt(header.toString('ascii',124,136).replace(/\0.*$/,'').trim(),8),size);
  let offset=0;while(offset<size){
   const {bytesRead}=await file.read(buf,0,Math.min(chunkBytes,size-offset),512+offset);
   assert.ok(bytesRead>0);hash.update(buf.subarray(0,bytesRead));offset+=bytesRead;
  }
  assert.equal(hash.digest('hex'),expected);
  assert.ok((await file.stat()).size>=size+1536);
 }finally{await file.close();}
}
const settled=page=>page.waitForFunction(()=>{
 const el=document.querySelector('.surface-content');
 return document.querySelector('[data-phase=details]')&&el&&!el.classList.contains('hidden')&&getComputedStyle(el).opacity==='1';
});
const count=page=>page.evaluate(async()=>{
 try{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('convert-temporary');
  let n=0;for await(const [name,item] of d)if(item.kind==='file'&&name.startsWith('convert-'))n++;return n;
 }catch(e){if(e.name==='NotFoundError')return 0;throw e;}
});
const reports=[];
async function run(engine,persistent=false,onlyFormat=null){
 const label=engine+(persistent?'-persistent':'-temporary')+(onlyFormat?'-'+onlyFormat.toLowerCase().replace(/[^a-z0-9]/g,''):'');
 const record={label,engine,persistent,startedAt:new Date().toISOString(),status:'failed',cases:[],errors:[],external:[],uploads:[]};
 reports.push(record);let browser,context,profile,page;
 try{
  if(persistent){
   profile=join(tmpdir(),'m1convert-phase83-'+process.pid+'-'+Math.random().toString(16).slice(2));
   context=await pw[engine].launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900},serviceWorkers:'block'});
  }else{
   browser=await pw[engine].launch({headless:true});
   context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  }
  record.version=browser?.version()||context.browser()?.version();
  await context.route('**/*',async route=>{
   const req=route.request(),address=req.url(),external=/^https?:/.test(address)&&!['localhost','127.0.0.1','[::1]'].includes(new URL(address).hostname);
   if(external)record.external.push(address);
   if(req.method()!=='GET')record.uploads.push(req.method()+' '+address);
   if(external||req.method()!=='GET')await route.abort();else await route.continue();
  });
  page=await context.newPage();page.setDefaultTimeout(60000);
  page.on('pageerror',e=>record.errors.push(e.message));
  await page.addInitScript(()=>{
   window.phase83={workers:0,resources:[],stages:[]};
   const NativeWorker=Worker;
   window.Worker=class extends NativeWorker{
    ended=false;
    constructor(...args){
     super(...args);window.phase83.workers++;
     this.addEventListener('message',e=>{
      if(e.data?.type==='converted')window.phase83.resources.push(e.data.result.resources);
      if(e.data?.type==='stage')window.phase83.stages.push(e.data);
     });
    }
    terminate(){if(!this.ended){this.ended=true;window.phase83.workers--;}super.terminate();}
   };
  });
  await page.goto(url);await page.locator('[data-ready=true]').waitFor();
  const storage=await page.evaluate(async()=>{
   try{await(await navigator.storage.getDirectory()).getDirectoryHandle('convert-temporary',{create:true});return {available:true};}
   catch(e){return {available:false,reason:e.name+': '+e.message};}
  });
  record.storage=storage;
  if(storage.available)assert.equal(await count(page),0,'New context should have no owned outputs');
  const output=page.getByRole('combobox',{name:'Output format'});
  const upload=async path=>{
   if(await page.locator('[data-phase=details]').count()){
    await page.getByRole('button',{name:'Remove file'}).click();
    await page.locator('[data-phase=upload]').waitFor();
   }
   await page.locator('input[type=file]').setInputFiles(path);
   await output.waitFor();await settled(page);
   const state=await page.waitForFunction(()=>{
    const select=document.querySelector('select');
    if(select&&!select.disabled)return 'ready';
    if(document.querySelector('main')?.textContent?.includes('64 MiB Blob memory'))return 'blob-input-limit';
    return null;
   });
   return state.jsonValue();
  };
  const convert=async format=>{
   await output.selectOption(format);
   await page.evaluate(()=>{window.phase83.stages=[];});
   await page.getByRole('button',{name:'Convert',exact:true}).click();
   const success=page.getByRole('button',{name:'Download',exact:true});
   const failure=page.locator('.error-message');
   return Promise.race([success.waitFor().then(()=>'success'),failure.waitFor().then(()=>'failure')]);
  };
  const download=async path=>{
   const pending=page.waitForEvent('download');
   await page.getByRole('button',{name:'Download',exact:true}).click();
   const d=await pending;try{await d.saveAs(path);}finally{await d.delete();}
  };
  const clean=async()=>{
   await page.waitForFunction(()=>window.phase83.workers===0);
   if(storage.available)await page.waitForFunction(async()=>{
    const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('convert-temporary');
    for await(const [name,item] of d)if(item.kind==='file'&&name.startsWith('convert-'))return false;return true;
   });
  };
  for(const [format,path] of [['ZIP',zip],['TAR.GZ',tgz]].filter(([format])=>(!onlyFormat||format===onlyFormat)&&(!process.env.ARCHIVES||process.env.ARCHIVES.split(',').includes(format)))){
   record.lastStep='upload '+format;
   const inputState=await upload(path);
   if(inputState==='blob-input-limit'){
    assert.equal(storage.available,false,'Input cap must not occur with available OPFS');
    assert.equal(format,'TAR.GZ','Unexpected input-analysis limit');
    const message=await page.locator('main').innerText();assert.match(message,/64 MiB Blob memory/);
    assert.equal(await upload('tests/fixtures/sample.tar'),'ready');
    assert.equal(await convert('TAR'),'success','Small retry after input-analysis cap');
    const retry=join(dir,label+'-input-recovery.tar');await download(retry);
    assert.ok((await stat(retry)).size>512);await rm(retry);
    await page.getByRole('button',{name:'Convert Again'}).click();await settled(page);await clean();
    record.cases.push({input:format,mode:'bounded-input-analysis',message,recovered:true});
    console.log('PASS',label,format,'bounded-input-analysis');continue;
   }
   assert.equal(inputState,'ready','Input must be inspected before conversion');
   record.lastStep='convert '+format;
   const outcome=await convert('TAR'),entry={input:format,bytes:(await stat(path)).size,outcome};
   if(storage.available){
    assert.equal(outcome,'success',format+' should stream to OPFS');
    const target=join(dir,label+'-'+format.replace('.','')+'.tar');
    await download(target);await verifyTar(target);await rm(target);
    const resources=await page.evaluate(()=>window.phase83.resources.at(-1));
    assert.equal(resources.mode,'opfs');assert.equal(resources.retainedBytes,0);
    assert.ok(resources.maxChunkBytes<=65536);
    assert.equal(await count(page),1);
    await page.getByRole('button',{name:'Convert Again'}).click();await settled(page);
    await clean();entry.mode='opfs';
   }else{
    assert.equal(outcome,'failure','Without OPFS, output larger than Blob cap must fail');
    entry.message=await page.locator('.error-message').innerText();
    assert.match(entry.message,/64 MiB Blob memory/);
    await page.getByRole('button',{name:'Back to details'}).click();await settled(page);
    await clean();entry.mode='bounded-rejection';
    await upload('tests/fixtures/sample.tar');
    assert.equal(await convert('TAR'),'success','Small input should recover after Blob cap');
    const retry=join(dir,label+'-recovery.tar');await download(retry);
    assert.ok((await stat(retry)).size>512);await rm(retry);
    await page.getByRole('button',{name:'Convert Again'}).click();await settled(page);await clean();
    entry.recovered=true;
   }
   record.cases.push(entry);
   console.log('PASS',label,format,entry.mode);
  }
  record.lastStep='long-audio';await upload(wav);
  assert.equal(await convert('AIFF'),'success','Long audio must remain available');
  const aiff=join(dir,label+'-long.aiff');await download(aiff);
  assert.equal(pcmHash(aiff),expectedPcm,'Independent FFmpeg PCM hash should match source');
  await rm(aiff);
  await page.getByRole('button',{name:'Convert Again'}).click();await settled(page);await clean();
  record.cases.push({input:'10-minute PCM WAV',output:'AIFF',pcmSha256:expectedPcm});
  console.log('PASS',label,'10-minute WAV to AIFF independent PCM');
  record.lastStep='cancellation';await upload(zip);
  await output.selectOption('TAR');
  await page.getByRole('button',{name:'Convert',exact:true}).click();
  const cancel=page.getByRole('button',{name:'Cancel',exact:true});
  await cancel.waitFor();await cancel.click();await settled(page);await clean();
  record.cases.push({input:'large ZIP',action:'cancel',result:'clean'});
  console.log('PASS',label,'cancel and cleanup');
  assert.deepEqual(record.errors,[]);
  assert.deepEqual(record.external,[]);
  assert.deepEqual(record.uploads,[]);
  record.status='passed';
 }catch(e){record.error=String(e);if(page)record.ui=await page.locator('main').innerText().catch(()=>null);process.exitCode=1;console.error('FAIL',label,record.lastStep,record.error);}
 finally{
  record.finishedAt=new Date().toISOString();
  if(context)await context.close().catch(e=>record.errors.push(String(e)));
  if(browser)await browser.close().catch(e=>record.errors.push(String(e)));
  if(profile)await rm(profile,{recursive:true,force:true});
  await writeFile(join(dir,label+'.json'),JSON.stringify(record,null,2)+'\n');
 }
}
try{
 for(const engine of engines){
  if(engine==='webkit'){
   for(const format of ['ZIP','TAR.GZ'].filter(f=>!process.env.ARCHIVES||process.env.ARCHIVES.split(',').includes(f))){
    if(process.env.WEBKIT_CONTEXT!=='persistent')await run(engine,false,format);
    if(process.env.WEBKIT_CONTEXT!=='temporary')await run(engine,true,format);
   }
  }else await run(engine);
 }
}finally{
 await writeFile(join(dir,'results.json'),JSON.stringify({size,expected,reports},null,2)+'\n');
 for(const path of [payload,zip,tgz,wav])await rm(path,{force:true});
}
if(reports.some(r=>r.status!=='passed'))process.exitCode=1;
