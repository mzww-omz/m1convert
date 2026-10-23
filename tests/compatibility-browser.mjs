import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {encodeBmp} from '../src/lib/adapters/bmp.ts';
import {encodeIco} from '../src/lib/adapters/ico.ts';
import {inspectFile} from '../src/lib/image-format.ts';
import {inspectAudioBytes} from '../src/lib/audio-validation.ts';
import {archiveCodec} from '../src/lib/adapters/archive.ts';
import {detectFormat,planConversion} from '../src/lib/registry.ts';
import {summarize,matrix} from './helpers/compatibility-report.mjs';

// Reuse the existing installation. Never download browsers or codecs.
const base=process.env.TEST_URL||'http://localhost:5173';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname),'TEST_URL must be local');
const dir='artifacts/phase8.1';await mkdir(dir,{recursive:true});
const fixture=async name=>({name,buffer:await readFile(new URL('./fixtures/'+name,import.meta.url)),mimeType:''});
const png=await fixture('swatch.png'),info=await inspectFile(new File([png.buffer],png.name));
const bmp=encodeBmp({width:2,height:2,data:new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255])});
// BMP/ICO/SVG use the existing encoders/static SVG subset, as in browser.mjs.
const images=[['PNG',png],['JPEG',await fixture('swatch.jpg')],['WEBP',await fixture('swatch.webp')],['AVIF',await fixture('swatch.avif')],
 ['BMP',{name:'swatch.bmp',buffer:Buffer.from(bmp),mimeType:''}],
 ['ICO',{name:'swatch.ico',buffer:Buffer.from(encodeIco([{width:info.width,height:info.height,bytes:png.buffer}])),mimeType:''}],
 ['SVG',{name:'swatch.svg',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="80"><rect width="128" height="80" fill="red"/></svg>'),mimeType:''}],
 ['GIF',await fixture('swatch.gif')],['TIFF',await fixture('swatch.tiff')]];
const audio=await Promise.all(['WAV','AIFF','MP3','FLAC','OGG','OPUS','AAC','M4A'].map(async id=>[id,await fixture('audio/music.'+id.toLowerCase())]));
const archives=await Promise.all([['ZIP','deflated.zip'],['TAR','sample.tar'],['TAR.GZ','sample.tar.gz'],['GZIP','hello.txt.gz']].map(async([id,name])=>[id,await fixture(name)]));
const groups=[{inputs:images,outputs:['PNG','JPEG','WEBP','BMP','ICO','TIFF']},{inputs:audio,outputs:['WAV','AIFF','MP3','FLAC','OGG','OPUS','AAC','M4A']},{inputs:archives,outputs:['ZIP','TAR','TAR.GZ','GZIP']}];
const template=groups.flatMap(g=>g.inputs.flatMap(([input])=>g.outputs.map(output=>({input,output,status:'untested',reason:'Not run'}))));
assert.equal(template.length,134);assert.equal(new Set(template.map(r=>`${r.input}:${r.output}`)).size,134);
for(const r of template)assert.equal(planConversion(r.input,r.output).steps.length,1);
let playwright,moduleError;try{playwright=await import(process.env.PLAYWRIGHT_MODULE||'playwright');}catch(e){moduleError=String(e);}
const selected=(process.env.BROWSERS||'chromium,firefox,webkit').split(',');
assert.ok(selected.every(b=>['chromium','firefox','webkit'].includes(b)),'Unknown BROWSERS value');
const reports=[];let failed=!!moduleError;
for(const name of ['chromium','firefox','webkit']) {
 const report={browser:name,startedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),base,node:process.version,platform:process.platform,arch:process.arch,routes:structuredClone(template),analyses:[],errors:[],external:[],uploads:[]};
 reports.push(report);let browser;
 try {
  if(!selected.includes(name)) {report.unavailable='Not selected by BROWSERS';continue;}
  if(moduleError){report.unavailable=moduleError;continue;}
  const executablePath=process.env[`PLAYWRIGHT_${name.toUpperCase()}_EXECUTABLE_PATH`]||(name==='chromium'?process.env.PLAYWRIGHT_EXECUTABLE_PATH:undefined);
  report.executablePath=executablePath||playwright[name].executablePath();
  try {browser=await playwright[name].launch({headless:true,executablePath});}
  catch(e){report.unavailable=String(e);if(!/executable doesn't exist|ENOENT/i.test(String(e)))failed=true;continue;}
  report.version=browser.version();
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await context.route('**/*',async route=>{
   const request=route.request(),url=request.url();
   const external=/^https?:/.test(url)&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
   if(external)report.external.push(url);
   if(request.method()!=='GET')report.uploads.push(request.method()+' '+url);
   if(external||request.method()!=='GET')await route.abort();else await route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(45000);
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{
   window.compat={analysis:null,error:null,result:null,workers:0};
   const W=Worker;window.Worker=class extends W {
    ended=false;
    constructor(...args){super(...args);window.compat.workers++;this.addEventListener('message',e=>{
     if(e.data.type==='analyzed')window.compat.analysis=e.data.analysis;
     if(e.data.type==='error')window.compat.error=e.data.message;
     if(e.data.type==='converted'){const {blob,...metadata}=e.data.result;window.compat.result={...metadata,size:blob.size};}
    });}
    terminate(){if(!this.ended){this.ended=true;window.compat.workers--;}super.terminate();}
   };
  });
  const output=()=>page.getByRole('combobox',{name:'Output format'});
  const settled=()=>page.waitForFunction(()=>document.querySelector('[data-phase=details]')&&!document.querySelector('.surface-content.hidden')&&getComputedStyle(document.querySelector('.surface-content')).opacity==='1');
  const upload=async file=>{
   await page.goto(base);await page.locator('[data-ready=true]').waitFor();
   await page.evaluate(()=>window.compat.surface=document.querySelector('[data-surface]'));
   await page.locator('input[type=file]').setInputFiles(file);
   await page.waitForFunction(()=>window.compat.analysis||window.compat.error);
   const state=await page.evaluate(()=>({analysis:window.compat.analysis,error:window.compat.error}));
   if(state.error)throw new Error(state.error);
   await settled();await page.waitForFunction(()=>!document.querySelector('select').disabled);
   return state.analysis;
  };
  for(const group of groups)for(const [input,file] of group.inputs) {
   let analysis,inspectionError;const t=performance.now();
   try{analysis=await upload(file);assert.equal(analysis.info.format,input);}catch(e){inspectionError=String(e);}
   report.analyses.push({input,fixture:file.name,ms:performance.now()-t,analysis,error:inspectionError});
   let recover=false;
   for(const target of group.outputs) {
    const route=report.routes.find(r=>r.input===input&&r.output===target);
    if(inspectionError){Object.assign(route,{status:'failed',reason:'Inspection: '+inspectionError});continue;}
    if(!analysis.outputs.includes(target)){Object.assign(route,{status:'unsupported',reason:'Real inspect/encoder probe did not advertise this output'});continue;}
    const start=performance.now();
    try {
     if(recover){analysis=await upload(file);recover=false;}
     await page.evaluate(()=>{window.compat.error=null;window.compat.result=null;});
     await output().selectOption(target);await page.getByRole('button',{name:'Convert',exact:true}).click();
     await page.waitForFunction(()=>window.compat.result||window.compat.error);
     const state=await page.evaluate(()=>({error:window.compat.error,result:window.compat.result,workers:window.compat.workers}));
     if(state.error)throw new Error(state.error);
     await page.getByRole('button',{name:'Download',exact:true}).waitFor();
     const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();
     const download=await pending,bytes=await readFile(await download.path());
     assert.ok(bytes.length);assert.equal(detectFormat(bytes)?.id,target);
     const saved=new File([bytes],download.suggestedFilename());
     if(group===groups[0])assert.equal((await inspectFile(saved)).format,target);
     else if(group===groups[1])assert.equal(inspectAudioBytes(saved,bytes).format,target);
     else assert.equal((await archiveCodec.inspect(saved,()=>{})).info.format,target);
     assert.equal(state.workers,0);
     assert.ok(await page.evaluate(()=>document.querySelector('[data-surface]')===window.compat.surface),'MorphSurface must persist');
     Object.assign(route,{status:'passed',reason:null,ms:performance.now()-start,result:state.result});
     await download.delete();
     await page.getByRole('button',{name:'Convert Again'}).click();await settled();
    }catch(e){Object.assign(route,{status:'failed',reason:String(e),ms:performance.now()-start});recover=true;}
    console.log(name,input+'→'+target,route.status);
   }
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);assert.deepEqual(report.uploads,[]);
 }catch(e){report.setupError=String(e);failed=true;}
 finally {
  if(report.unavailable)for(const route of report.routes)route.reason=report.unavailable;
  report.summary=summarize(report.routes);if(report.summary.failed)failed=true;
  if(process.env.REQUIRE_BROWSERS==='1'&&report.summary.untested)failed=true;
  report.finishedAt=new Date().toISOString();
  await writeFile(`${dir}/${name}.json`,JSON.stringify(report,null,2)+'\n');
  if(browser)await browser.close();
  console.log(name,JSON.stringify(report.summary),report.unavailable??report.setupError??'');
 }
}
await writeFile(`${dir}/matrix.md`,matrix(reports));
await writeFile(`${dir}/results.json`,JSON.stringify(reports,null,2)+'\n');
if(failed)process.exitCode=1;
