import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {crc32} from '../src/lib/adapters/archive.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],uploads=[],external=[];
page.setDefaultTimeout(45000);
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.method()!=='GET')uploads.push(r.url());if(/^https?:/.test(r.url())&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());});
const output=()=>page.getByRole('combobox',{name:'Output format'});
const load=async(buffer,name='wrong.bin',mimeType='text/plain')=>{await page.locator('input[type=file]').setInputFiles({name,mimeType,buffer});await output().waitFor();await page.waitForFunction(()=>{const s=document.querySelector('select');return s&&!s.disabled&&!document.querySelector('.surface-content.hidden');});};
const convert=async(format)=>{await output().selectOption(format);await page.getByRole('button',{name:'Convert',exact:true}).click();await page.getByRole('button',{name:'Download',exact:true}).waitFor();};
const again=async()=>{await page.getByRole('button',{name:'Convert Again'}).click();await output().waitFor();};
try {
 await page.goto(process.env.TEST_URL||'http://localhost:5173');await page.locator('[data-ready=true]').waitFor();
 await page.locator('[data-surface]').evaluate(el=>window.originalSurface=el);
 for(const [width,height] of [[20000,2],[4100,4100]]) {
  const bytes=await page.evaluate(async({width,height})=>{const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d').fillRect(0,0,width,height);return [...new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer())];},{width,height});
  await load(Buffer.from(bytes));await convert('PNG');await again();
  if(width===20000) {
   await output().selectOption('WEBP');await page.getByRole('button',{name:'Convert',exact:true}).click();
   await page.locator('.error-message').filter({hasText:/WEBP.*20000.*Try PNG/i}).waitFor();
   await page.getByRole('button',{name:'Back to details'}).click();await output().waitFor();
  }
 }
 const png=await readFile(new URL('./fixtures/swatch.png',import.meta.url)),chunk=Buffer.alloc(33*1024**2+12);
 chunk.writeUInt32BE(chunk.length-12);chunk.write('tEXt',4);chunk[8]=65;chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);
 await load(Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)]));await convert('PNG');await again();
 await page.setViewportSize({width:320,height:740});await page.waitForTimeout(600);
 assert.equal(await page.getByText(/Compatibility warning:/).count(),2);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await mkdir('artifacts/phase4',{recursive:true});await page.screenshot({path:'artifacts/phase4/warnings-mobile.png',fullPage:true});
 const bad=Buffer.from(png);bad.fill(0,45,55);
 await page.locator('input[type=file]').setInputFiles({name:'corrupt.png',mimeType:'image/png',buffer:bad});
 await page.locator('#conversion-note').filter({hasText:/corrupt|truncated|decode/i}).waitFor();assert.ok(await output().isDisabled());
 assert.ok(await page.evaluate(()=>document.querySelector('[data-surface]')===window.originalSurface));
 assert.deepEqual(errors,[]);assert.deepEqual(uploads,[]);assert.deepEqual(external,[]);
 console.log('PASS 20000px and >16MP PNG conversion, WebP encoder recovery, real >32MiB decode/conversion, corrupted pixels, mobile warnings, same MorphSurface, no uploads');
} catch(error) {console.error(await page.locator('main').innerText());throw error;} finally {await browser.close();}
