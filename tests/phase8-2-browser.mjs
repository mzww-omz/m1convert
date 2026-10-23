import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {open,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encodeTar} from '../src/lib/adapters/archive.ts';

const url=process.env.TEST_URL||'http://127.0.0.1:4181';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname),'Local preview required');
const engines=(process.env.BROWSERS||'chromium,firefox,webkit').split(',').map(x=>x.trim());
assert.ok(engines.length&&engines.every(x=>['chromium','firefox','webkit'].includes(x)),'Invalid BROWSERS');
const pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir='artifacts/phase8.2';await mkdir(dir,{recursive:true});
const input=join(dir,'large.tar'),size=68*1024**2,step=1024**2;
const h=encodeTar([{name:'payload.bin',directory:false,mtime:1700000000,data:new Uint8Array()}]).slice(0,512);
h.set(new TextEncoder().encode(size.toString(8).padStart(11,'0')+'\0'),124);
h.fill(32,148,156);
h.set(new TextEncoder().encode(h.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 '),148);
let seed=20261023;const chunk=Buffer.allocUnsafe(step),digest=createHash('sha256');
for(let i=0;i<step;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;chunk[i]=seed&255;}
const fh=await open(input,'w');
try{await fh.write(h);for(let i=0;i<size/step;i++){await fh.write(chunk);digest.update(chunk);}await fh.write(Buffer.alloc(1024));}
finally{await fh.close();}
const expected=digest.digest('hex'),reports=[];

async function verifyTar(path){
 const f=await open(path,'r'),buf=Buffer.allocUnsafe(step),head=Buffer.alloc(512),hash=createHash('sha256');
 try{
  assert.equal((await f.read(head,0,512,0)).bytesRead,512);
  assert.equal(head.toString('utf8',0,100).replace(/\0.*$/,''),'payload.bin');
  assert.equal(parseInt(head.toString('ascii',124,136).replace(/\0.*$/,'').trim(),8),size);
  let offset=0;
  while(offset<size){
   const {bytesRead}=await f.read(buf,0,Math.min(step,size-offset),512+offset);
   assert.ok(bytesRead>0);hash.update(buf.subarray(0,bytesRead));offset+=bytesRead;
  }
  assert.equal(hash.digest('hex'),expected);
 }finally{await f.close();}
}
const count=page=>page.evaluate(async()=>{
 try{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('convert-temporary');
  let n=0;for await(const [name,item] of d)if(item.kind==='file'&&name.startsWith('convert-'))n++;return n;
 }catch(e){if(e.name==='NotFoundError')return 0;throw e;}
});
const settled=page=>page.waitForFunction(()=>{
 const s=document.querySelector('.surface-content');
 return !!document.querySelector('[data-phase=details]')&&!!s&&!s.classList.contains('hidden')&&getComputedStyle(s).opacity==='1';
});
async function run(engine,persistent){
 const label=engine+(persistent?'-persistent':'-private');
 const r={label,engine,persistent,startedAt:new Date().toISOString(),bytes:size+1536,sha256:expected,status:'failed',errors:[],external:[],uploads:[]};
 reports.push(r);let browser,context,profile;
 try{
  if(persistent){
   profile=await mkdtemp(join(tmpdir(),'m1convert-phase82-'));
   context=await pw[engine].launchPersistentContext(profile,{headless:true,viewport:{width:1280,height:900},serviceWorkers:'block'});
  }else{
   browser=await pw[engine].launch({headless:true});
   context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  }
  r.version=browser?.version()||context.browser()?.version();
  await context.route('**/*',async route=>{
   const request=route.request(),address=request.url(),external=/^https?:/.test(address)&&!['localhost','127.0.0.1','[::1]'].includes(new URL(address).hostname);
   if(external)r.external.push(address);
   if(request.method()!=='GET')r.uploads.push(request.method()+' '+address);
   if(external||request.method()!=='GET')await route.abort();else await route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(180000);
  page.on('pageerror',e=>r.errors.push(e.message));
  await page.addInitScript(()=>{
   window.phase82={resources:[],workers:0};
   const W=Worker;
   window.Worker=class extends W{
    ended=false;
    constructor(...args){super(...args);window.phase82.workers++;
     this.addEventListener('message',e=>{if(e.data.type==='converted')window.phase82.resources.push(e.data.result.resources);});
    }
    terminate(){if(!this.ended){this.ended=true;window.phase82.workers--;}super.terminate();}
   };
  });
  await page.goto(url);await page.locator('[data-ready=true]').waitFor();
  r.storage=await page.evaluate(async()=>{
   try{const d=await navigator.storage.getDirectory();await d.getDirectoryHandle('convert-temporary',{create:true});return {available:true};}
   catch(e){return {available:false,reason:e.name+': '+e.message};}
  });
  if(r.storage.available)assert.equal(await count(page),0,'Expected fresh profile');
  await page.locator('input[type=file]').setInputFiles(input);
  await page.getByRole('combobox',{name:'Output format'}).waitFor();
  await settled(page);await page.waitForFunction(()=>!document.querySelector('select').disabled);
  await page.getByRole('combobox',{name:'Output format'}).selectOption('TAR');
  await page.getByRole('button',{name:'Convert',exact:true}).click();
  const download=page.getByRole('button',{name:'Download',exact:true});
  const error=page.locator('.error-message');
  r.outcome=await Promise.race([download.waitFor().then(()=>'download'),error.waitFor().then(()=>'error')]);
  if(r.storage.available){
   assert.equal(r.outcome,'download','Accessible OPFS must stream a large output');
   const pending=page.waitForEvent('download');await download.click();const d=await pending;
   try{await verifyTar(await d.path());}finally{await d.delete();}
   await page.waitForFunction(()=>window.phase82.workers===0);
   r.resources=await page.evaluate(()=>window.phase82.resources.at(-1));
   assert.equal(r.resources?.mode,'opfs');assert.equal(r.resources?.retainedBytes,0);
   assert.ok(r.resources?.maxChunkBytes<=65536);
   assert.equal(await count(page),1,'Completed output must remain leased');
   const other=await context.newPage();
   try{
    await other.goto(url);await other.locator('[data-ready=true]').waitFor();
    assert.equal(await count(other),1,'Other tab must see still-leased output');
    await page.getByRole('button',{name:'Convert Again'}).click();await settled(page);
    await other.waitForFunction(async()=>{
     try{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('convert-temporary');
      for await(const _ of d.values())return false;return true;}
     catch(e){return e.name==='NotFoundError';}
    });
    assert.equal(await count(other),0,'Cross-tab release must remove output');
   }finally{await other.close();}
  }else{
   assert.equal(r.outcome,'error','No OPFS cannot exceed Blob budget');
   r.largeError=await error.innerText();assert.match(r.largeError,/64 MiB Blob memory/);
   await page.waitForFunction(()=>window.phase82.workers===0);
   await page.getByRole('button',{name:'Back to details'}).click();await settled(page);
   await page.getByRole('button',{name:'Remove file'}).click();
   await page.locator('[data-phase=upload]').waitFor();
   await page.locator('input[type=file]').setInputFiles('tests/fixtures/sample.tar');
   await page.getByRole('combobox',{name:'Output format'}).waitFor();await settled(page);
   await page.getByRole('combobox',{name:'Output format'}).selectOption('TAR');
   await page.getByRole('button',{name:'Convert',exact:true}).click();await download.waitFor();
   const pending=page.waitForEvent('download');await download.click();const d=await pending;
   try{assert.ok((await readFile(await d.path())).length>512);}
   finally{await d.delete();}
   assert.equal((await page.evaluate(()=>window.phase82.resources.at(-1)))?.mode,'blob');
   await page.getByRole('button',{name:'Convert Again'}).click();await settled(page);
   r.recoveredWithBlob=true;
  }
  assert.deepEqual(r.errors,[]);assert.deepEqual(r.external,[]);assert.deepEqual(r.uploads,[]);
  r.status='passed';console.log('PASS',label,JSON.stringify({storage:r.storage,outcome:r.outcome,mode:r.resources?.mode}));
 }catch(e){r.error=String(e);process.exitCode=1;console.error('FAIL',label,r.error);}
 finally{
  r.finishedAt=new Date().toISOString();
  if(context)await context.close().catch(e=>r.errors.push(String(e)));
  if(browser)await browser.close().catch(e=>r.errors.push(String(e)));
  if(profile)await rm(profile,{recursive:true,force:true});
  await writeFile(join(dir,label+'.json'),JSON.stringify(r,null,2)+'\n');
 }
}
try{for(const engine of engines){await run(engine,false);if(engine==='webkit')await run(engine,true);}}
finally{await writeFile(join(dir,'results.json'),JSON.stringify(reports,null,2)+'\n');await rm(input);}
if(reports.some(r=>r.status!=='passed'))process.exitCode=1;
