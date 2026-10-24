import assert from 'node:assert/strict';
import {mkdir,open,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {encodeTar} from '../src/lib/adapters/archive.ts';
import {encodeWav} from '../src/lib/adapters/pcm.ts';
const dir='artifacts/phase7';await mkdir(dir,{recursive:true});
const large=`${dir}/large.tar`,size=96*1024**2;
const header=encodeTar([{name:'payload.bin',directory:false,mtime:1700000000,data:new Uint8Array()}]).slice(0,512);
header.set(new TextEncoder().encode(size.toString(8).padStart(11,'0')+'\0'),124);header.fill(32,148,156);header.set(new TextEncoder().encode(header.reduce((n,v)=>n+v,0).toString(8).padStart(6,'0')+'\0 '),148);
const file=await open(large,'w'),hash=createHash('sha256'),block=new Uint8Array(1024**2);let seed=123456789;
for(let i=0;i<block.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;block[i]=seed&255;}
try{await file.write(header);for(let i=0;i<96;i++){await file.write(block);hash.update(block);}await file.write(new Uint8Array(1024));}finally{await file.close();}
const expectedHash=hash.digest('hex');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage(),errors=[],external=[],uploads=[],results=[];page.setDefaultTimeout(120000);
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')uploads.push(r.url());if(/^https?:/.test(r.url())&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());});
await page.addInitScript(()=>{
 window.mode='normal';window.workers=0;window.converted=[];window.stages=[];
 const W=Worker;window.Worker=class extends W {
  ended=false;
  constructor(url,options) {
   const code=`const queued=[];self.onmessage=e=>queued.push(e);const mode=${JSON.stringify(window.mode)};
    if(mode==='single-read'){const read=File.prototype.arrayBuffer,seen=new WeakSet();File.prototype.arrayBuffer=function(){if(seen.has(this))throw new Error('Input fully read twice');seen.add(this);return read.call(this);};}
    if(mode==='blob')Object.defineProperty(navigator.storage,'getDirectory',{value:undefined});
    if(mode==='quota')FileSystemFileHandle.prototype.createWritable=()=>Promise.reject(new DOMException('simulated quota exhaustion','QuotaExceededError'));
    if(mode==='quota-close')FileSystemWritableFileStream.prototype.close=()=>Promise.reject(new DOMException('simulated quota exhaustion on commit','QuotaExceededError'));
    if(mode==='oom'){const read=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=function(){return this.size>=65536?Promise.reject(new RangeError('simulated allocation failure')):read.call(this);};}
    await import(${JSON.stringify(String(url))});for(const e of queued)self.onmessage(e);`;
   const shim=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));super(shim,options);this.shim=shim;window.workers++;
   this.addEventListener('message',e=>{if(e.data.type==='converted')window.converted.push(e.data.result.resources);if(e.data.type==='stage')window.stages.push(e.data);});
  }
  terminate(){if(!this.ended){this.ended=true;window.workers--;URL.revokeObjectURL(this.shim);}super.terminate();}
 };
 const original=navigator.storage.getDirectory.bind(navigator.storage);
 window.storageGate=false;
 navigator.storage.getDirectory=async()=>{
  const root=await original(),get=root.getDirectoryHandle.bind(root);
  root.getDirectoryHandle=async(...args)=>{
   const d=await get(...args),getFile=d.getFileHandle.bind(d);
   d.getFileHandle=async(...args)=>{
    if(window.storageGate&&args[1]?.create){window.storageWaiting=true;await new Promise(resolve=>window.releaseStorage=resolve);}
    return getFile(...args);
   };return d;
  };return root;
 };
});
const output=()=>page.getByRole('combobox',{name:'Output format'});
const settled=()=>page.waitForFunction(()=>document.querySelector('[data-phase=details]')&&!document.querySelector('.surface-content.hidden')&&getComputedStyle(document.querySelector('.surface-content')).opacity==='1');
const tempCount=()=>page.evaluate(async()=>{try{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('convert-temporary');let n=0;for await(const _ of d.values())n++;return n;}catch(e){if(e.name==='NotFoundError')return 0;throw e;}});
const clean=async()=>{await page.waitForFunction(async()=>{try{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('convert-temporary');for await(const _ of d.values())return false;return true;}catch(e){return e.name==='NotFoundError';}});assert.equal(await page.evaluate(()=>window.workers),0);};
const upload=async path=>{await page.evaluate(()=>window.mode='normal');await page.locator('input[type=file]').setInputFiles(path);await output().waitFor();await settled();await page.waitForFunction(()=>!document.querySelector('select').disabled);await clean();};
const start=async(format,mode='normal')=>{await output().selectOption(format);await page.evaluate(mode=>{window.mode=mode;window.stages=[];},mode);await page.getByRole('button',{name:'Convert',exact:true}).click();};
const complete=async label=>{
 const t=performance.now();await Promise.race([page.getByRole('button',{name:'Download',exact:true}).waitFor(),page.locator('.error-message').waitFor().then(async()=>{throw new Error(await page.locator('.error-message').innerText());})]);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();const download=await pending,path=`${dir}/${label}-${download.suggestedFilename()}`;await download.saveAs(path);
 assert.equal(await page.evaluate(()=>window.workers),0);const resources=await page.evaluate(()=>window.converted.at(-1));results.push({label,ms:performance.now()-t,resources});return {path,resources};
};
const again=async()=>{await page.getByRole('button',{name:'Convert Again'}).click();await settled();await clean();};
try {
 await page.goto(process.env.TEST_URL||'http://localhost:5173');await page.locator('[data-ready=true]').waitFor();await page.locator('[data-surface]').evaluate(e=>window.surface=e);
 await upload(large);
 for(const format of ['TAR','ZIP','TAR.GZ','GZIP']) {
  if(format==='ZIP'){await output().selectOption('ZIP');await page.getByRole('combobox',{name:'Compression',exact:true}).selectOption('store');}
  await start(format);const {path,resources}=await complete(format);
  assert.equal(resources.mode,'opfs');assert.equal(resources.retainedBytes,0);assert.ok(resources.maxChunkBytes<=65536);
  const verify=spawnSync('python3',['-c',`import tarfile,zipfile,gzip,hashlib,sys\np=sys.argv[1];f=sys.argv[2]\nif f=='ZIP':\n z=zipfile.ZipFile(p);r=z.open('payload.bin')\nelif f=='GZIP':r=gzip.open(p,'rb')\nelse:\n z=tarfile.open(p);r=z.extractfile('payload.bin')\nh=hashlib.sha256();n=0\nwhile True:\n b=r.read(65536)\n if not b:break\n h.update(b);n+=len(b)\nassert n==${size}\nassert h.hexdigest()=='${expectedHash}'\n`,path,format],{encoding:'utf8'});assert.equal(verify.status,0,verify.stderr);
  assert.equal(await tempCount(),1,'only completed output remains');
  assert.equal(await page.evaluate(async()=>{const state=await navigator.locks.query();return state.held.filter(l=>l.name.startsWith('convert-temporary/')).length;}),1,'completed output stays leased across Worker termination');
  assert.ok(await page.evaluate(()=>window.stages.some(s=>s.stage==='verifying'&&s.percent>85)));
  await again();
 }
 // Large ZIP and TAR.GZ inputs also decode incrementally, not just TAR output.
 for(const path of [`${dir}/ZIP-large.zip`,`${dir}/TAR.GZ-large.tar.gz`]) {
  await upload(path);await start('TAR');const saved=await complete('large-input');assert.equal(saved.resources.mode,'opfs');await again();
 }
 await start('TAR','blob');await page.locator('.error-message').filter({hasText:/64 MiB Blob memory/}).waitFor();await clean();
 await page.getByRole('button',{name:'Back to details'}).click();await settled();
 for(const [mode,message] of [['quota',/Temporary disk output/],['quota-close',/could not be finalized/],['oom',/could not allocate/]]) {
  await start('TAR',mode);await page.locator('.error-message').filter({hasText:message}).waitFor();await clean();
  await page.getByRole('button',{name:'Back to details'}).click();await settled();
 }
 // Cancel while host-side file creation is pending: cleanup must await it, not race it.
 await page.evaluate(()=>{window.storageGate=true;window.storageWaiting=false;});await start('TAR');await page.waitForFunction(()=>window.storageWaiting);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await settled();assert.equal(await page.evaluate(()=>window.workers),0);
 await page.evaluate(()=>{window.storageGate=false;window.releaseStorage();});await clean();
 await start('ZIP');await page.waitForFunction(()=>window.stages.some(s=>s.stage==='encoding'&&s.percent>0));await page.getByRole('button',{name:'Cancel',exact:true}).click();await settled();await clean();
 await start('TAR');await complete('retry');await again();
 // Cancel source analysis while a gzip spool is being created, then retry with a fresh input.
 await page.evaluate(()=>{window.storageGate=true;window.storageWaiting=false;});
 await page.locator('input[type=file]').setInputFiles(`${dir}/TAR.GZ-large.tar.gz`);await page.waitForFunction(()=>window.storageWaiting);
 await page.getByRole('button',{name:'Remove file'}).click();await page.locator('[data-phase=upload]').waitFor();
 assert.equal(await page.evaluate(()=>window.workers),0);await page.evaluate(()=>{window.storageGate=false;window.releaseStorage();});await clean();
 // Small fallback is still usable without OPFS.
 await upload('tests/fixtures/sample.tar');await start('ZIP','blob');const fallback=await complete('fallback');assert.equal(fallback.resources.mode,'blob');await again();
 // Custom image decoders reuse the already-validated source bytes.
 const {encodeBmp}=await import('../src/lib/adapters/bmp.ts'),{decodeTiff}=await import('../src/lib/adapters/tiff.ts');
 await writeFile(`${dir}/swatch.bmp`,encodeBmp(decodeTiff(await readFile('tests/fixtures/swatch.tiff'))));
 for(const [ext,path] of [['tiff','tests/fixtures/swatch.tiff'],['bmp',`${dir}/swatch.bmp`]]){await upload(path);await start('PNG','single-read');await complete(`single-read-${ext}`);await again();}
 // Ten-minute mono PCM remains within the existing decoded-sample budget; no fake streaming claim.
 const long=`${dir}/long.wav`,samples=8000*600,h=encodeWav({sampleRate:8000,channels:1,samples:new Float32Array(1)}).slice(0,44),v=new DataView(h.buffer);v.setUint32(4,36+samples*2,true);v.setUint32(40,samples*2,true);
 const a=await open(long,'w');try{await a.write(h);const b=new Uint8Array(16000);for(let i=0;i<8000;i++)new DataView(b.buffer).setInt16(i*2,(i%128)*128-8192,true);for(let i=0;i<600;i++)await a.write(b);}finally{await a.close();}
 await upload(long);await start('AIFF');const audio=await complete('long-audio');
 const pcmHash=p=>{const r=spawnSync('ffmpeg',['-v','error','-i',p,'-f','s16le','-acodec','pcm_s16le','-f','hash','-hash','sha256','-'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
 assert.equal(pcmHash(long),pcmHash(audio.path));await again();
 await page.getByRole('button',{name:'Remove file'}).click();await page.locator('[data-phase=upload]').waitFor();await clean();
 assert.ok(await page.evaluate(()=>document.querySelector('[data-surface]')===window.surface));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(uploads,[]);
 await writeFile(`${dir}/results.json`,JSON.stringify({browser:browser.version(),inputBytes:size+1536,expectedHash,memory:{browserPeakRss:null,browserPeakHeap:null,reason:'Not measured; sink retainedBytes/maxChunkBytes are application counters, not process peaks.'},results,errors,external,uploads},null,2));
 console.log('PASS 96 MiB archive streaming, independent Python byte integrity, OPFS/Blob/quota/OOM, Cancel/create race/retry/cleanup, 10-minute PCM, same MorphSurface, no uploads');
} finally {await browser.close();}
