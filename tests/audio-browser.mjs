import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {formatById} from '../src/lib/registry.ts';
import {decodeZip} from '../src/lib/adapters/archive.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(45000);
const errors=[],external=[],uploads=[],requests=[],progress=[],paths=[],timings=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{requests.push(r.url());if(/^https?:/.test(r.url())&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());if(r.method()!=='GET')uploads.push(r.url());});
await page.addInitScript(()=>{
 const W=Worker;window.workers=0;window.stages=[];window.liveUrls=new Set();
 window.Worker=class extends W {ended=false;constructor(...args){super(...args);window.workers++;this.addEventListener('message',e=>{if(e.data.type==='stage')window.stages.push(e.data);});}terminate(){if(!this.ended){this.ended=true;window.workers--;}super.terminate();}};
 const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const u=create(b);window.liveUrls.add(u);return u;};URL.revokeObjectURL=u=>{window.liveUrls.delete(u);revoke(u);};
});
const base=process.env.TEST_URL||'http://localhost:5173',dir='artifacts/audio';await mkdir(dir,{recursive:true});
const ready=()=>page.waitForFunction(()=>{const el=document.querySelector('.surface-content'),button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Convert'));return document.querySelector('[data-phase=details]')&&el&&!el.classList.contains('hidden')&&getComputedStyle(el).opacity==='1'&&button&&!button.disabled;});
const fixture=async ext=>({name:'music.'+ext,mimeType:'',buffer:await readFile(new URL('./fixtures/audio/music.'+ext,import.meta.url))});
const upload=async input=>{await page.locator('input[type=file]').setInputFiles(input);await page.getByRole('heading',{name:(Array.isArray(input)?input[0]:input).name,exact:true}).waitFor();await ready();};
const output=()=>page.getByRole('combobox',{name:'Output format'});
const again=async()=>{await page.getByRole('button',{name:'Convert Again',exact:true}).click();await ready();};
const convert=async()=>{const start=performance.now();await page.getByRole('button',{name:'Convert',exact:true}).click();await Promise.race([page.getByRole('button',{name:'Download',exact:true}).waitFor(),page.locator('.error-message').waitFor().then(async()=>{throw Error(await page.locator('.error-message').innerText());})]);return performance.now()-start;};
const download=async path=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();const d=await pending;await d.saveAs(path);return {name:d.suggestedFilename(),bytes:await readFile(path)};};
function probe(path){const p=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);}
function decode(path){const p=spawnSync('ffmpeg',['-v','error','-i',path,'-f','f32le','-acodec','pcm_f32le','-'],{maxBuffer:128*1024**2});assert.equal(p.status,0,p.stderr.toString());return new Float32Array(p.stdout.buffer.slice(p.stdout.byteOffset,p.stdout.byteOffset+p.stdout.length));}
function snr(reference,decoded,channels=2){let best=Infinity,bestLag=0;
 for(let lag=-4096;lag<=4096;lag++){let error=0;for(let i=5000;i<Math.min(reference.length/channels,decoded.length/channels)-5000;i+=277)for(let c=0;c<channels;c++){const j=i+lag;if(j>=0&&j<decoded.length/channels)error+=(reference[i*channels+c]-decoded[j*channels+c])**2;}if(error<best){best=error;bestLag=lag;}}
 let signal=0,noise=0;for(let i=5000;i<Math.min(reference.length/channels,decoded.length/channels)-5000;i++)for(let c=0;c<channels;c++){const a=reference[i*channels+c],b=decoded[(i+bestLag)*channels+c];signal+=a*a;noise+=(a-b)**2;}
 return {db:10*Math.log10(signal/Math.max(noise,1e-20)),lag:bestLag};
}
try {
 await page.goto(base);await page.locator('[data-ready=true]').waitFor();await page.locator('[data-surface]').evaluate(el=>window.surface=el);
 assert.equal(requests.filter(u=>u.includes('/vendor/')).length,0,'no WASM on initial load');
 await upload(await fixture('wav'));const choices=await output().locator('option').evaluateAll(options=>options.map(o=>o.value));
 assert.ok(choices.includes('MP3')&&choices.includes('FLAC')&&choices.includes('OGG')&&choices.includes('OPUS'),'self-hosted WASM encoders must really load');
 console.log('CAPABILITIES',choices);assert.ok(choices.includes('AAC')&&choices.includes('M4A'),'tested Chromium must exercise native AAC, not silently skip it');
 const reference=decode('tests/fixtures/audio/music.wav');
 for(const [id,ext] of [['WAV','wav'],['AIFF','aiff'],['MP3','mp3'],['FLAC','flac'],['OGG','ogg'],['OPUS','opus'],['AAC','aac'],['M4A','m4a']]) {
  await upload(await fixture(ext));
  for(const format of choices){await output().selectOption(format);const ms=await convert(),path=`${dir}/${id}-to-${format}.${formatById(format).extension}`,saved=await download(path),metadata=probe(path),stream=metadata.streams[0];
   assert.equal(metadata.streams.length,1);assert.equal(stream.codec_type,'audio');assert.equal(stream.channels,2);assert.equal(+stream.sample_rate,48000);
   assert.equal(stream.codec_name,{WAV:'pcm_s16le',MP3:'mp3',FLAC:'flac',OGG:'vorbis',OPUS:'opus',AAC:'aac',M4A:'aac'}[format]);
   const decoded=decode(path),duration=decoded.length/stream.channels/(+stream.sample_rate);
   assert.ok(Math.abs(duration-2)<.13,`${id}→${format} actual decoded duration ${duration}`);
   assert.ok(!metadata.format.tags?.title&&!metadata.format.tags?.artist&&!stream.tags?.title,'source metadata removed');
   const quality=snr(reference,decoded);assert.ok(quality.db>15,`${id}→${format} SNR ${quality.db}`);
   assert.ok(saved.bytes.length);paths.push(`${id}→${format}`);timings.push({input:id,output:format,ms,bytes:saved.bytes.length,snr:quality});console.log('AUDIO',id,format,Math.round(ms)+'ms',quality.db.toFixed(1)+'dB');
   assert.equal(await page.evaluate(()=>window.workers),0);await again();
  }
 }
 await upload(await fixture('wav'));
 if(await output().locator('option[value="AAC"]').count()) {
  await output().selectOption('AAC');await page.getByRole('combobox',{name:'Bitrate',exact:true}).selectOption('512');await convert();
  await download(`${dir}/aac-512.aac`);assert.equal(probe(`${dir}/aac-512.aac`).streams[0].codec_name,'aac');await again();
 }
 await output().selectOption('MP3');
 for(const bitrate of ['128','320']){await page.getByRole('combobox',{name:'Bitrate',exact:true}).selectOption(bitrate);await convert();const p=`${dir}/bitrate-${bitrate}.mp3`;await download(p);assert.ok(Math.abs(+probe(p).streams[0].bit_rate-(+bitrate)*1000)<1000);await again();}
 for(const format of ['MP3','OGG']){await output().selectOption(format);await page.getByRole('combobox',{name:'Encoding mode'}).selectOption('quality');const results=[];
  for(const key of ['Home','End']){await page.getByRole('slider',{name:/Quality/}).focus();await page.keyboard.press(key);await convert();const path=`${dir}/quality-${format}-${key}.${formatById(format).extension}`,saved=await download(path);results.push({bytes:saved.bytes,snr:snr(reference,decode(path)).db});await again();}
  assert.notDeepEqual(results[0].bytes,results[1].bytes);assert.ok(results[1].snr>results[0].snr,`${format} quality must affect actual audio quality`);
 }
 await page.getByRole('combobox',{name:'Encoding mode'}).selectOption('bitrate');await output().selectOption('MP3');
 await page.getByRole('combobox',{name:'Sample rate',exact:true}).selectOption('44100');await page.getByRole('combobox',{name:'Channels',exact:true}).selectOption('1');await convert();await download(`${dir}/mono-44100.mp3`);assert.equal(probe(`${dir}/mono-44100.mp3`).streams[0].channels,1);assert.equal(+probe(`${dir}/mono-44100.mp3`).streams[0].sample_rate,44100);await again();
 await page.screenshot({path:`${dir}/desktop.png`});await page.setViewportSize({width:320,height:740});await page.waitForTimeout(500);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${dir}/mobile.png`});await page.setViewportSize({width:1280,height:900});
 await upload([await fixture('mp3'),await fixture('flac'),await fixture('m4a')]);await output().selectOption('OPUS');await convert();const batch=await download(`${dir}/batch.zip`),entries=await decodeZip(batch.bytes);assert.equal(entries.length,3);for(const [i,e] of entries.entries()){const p=`${dir}/batch-${i}.opus`;await writeFile(p,e.data);assert.equal(probe(p).streams[0].codec_name,'opus');}await again();
 progress.push(...await page.evaluate(()=>window.stages.filter(s=>typeof s.percent==='number')));assert.ok(progress.some(p=>p.percent>0&&p.percent<95),'measured encoded-frame progress');
 // Unsupported ALAC-in-M4A must not inherit AAC support from the container extension.
 await page.locator('input[type=file]').setInputFiles(await fixture('alac.m4a'));await page.locator('#conversion-note').filter({hasText:/single-track AAC|codec/i}).waitFor();assert.ok(await output().isDisabled());
 await page.getByRole('button',{name:'Remove file'}).click();await page.locator('[data-phase=upload]').waitFor();assert.equal(await page.evaluate(()=>window.workers),0);assert.equal(await page.evaluate(()=>window.liveUrls.size),0);assert.ok(await page.evaluate(()=>document.querySelector('[data-surface]')===window.surface));
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(uploads,[]);await writeFile(`${dir}/results.json`,JSON.stringify({version:browser.version(),paths,timings,progress:progress.length},null,2));console.log('PASS',paths.length,'real audio routes, independent FFmpeg decode/SNR/metadata/bitrate, quality controls, mono/resampling, batch, progress, DOM and resource cleanup');
}catch(error){console.error('UI',await page.locator('main').innerText());throw error;}finally{await browser.close();}
