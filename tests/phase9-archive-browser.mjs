import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodeZip} from '../src/lib/adapters/archive.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage();
page.setDefaultTimeout(120000);
const errors=[],remote=[],posts=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{
  if(r.method()!=='GET')posts.push(r.url());
  if(/^https?:/.test(r.url())&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))remote.push(r.url());
});
try {
  await page.goto(process.env.TEST_URL||'http://localhost:5173');
  await page.locator('[data-ready=true]').waitFor();
  const fixtures=[
    ['phase9-sample.7z','7z','7Z'],
    ['phase9-sample.tar.xz','tar.xz','XZ'],
    ['phase9-sample.tar.bz2','tar.bz2','BZ2'],
    ['phase9-sample.tar.zst','tar.zst','ZSTD'],
    ['phase9-sample-rar3.rar','rar','RAR3'],
    ['phase9-sample-rar5.rar','rar','RAR5']
  ];
  for(const [path,extension,expected] of fixtures) {
    const bytes=await readFile(new URL('./fixtures/'+path,import.meta.url));
    await page.locator('input[type=file]').setInputFiles({name:'test.'+extension,mimeType:'application/octet-stream',buffer:bytes});
    await Promise.race([
      page.locator('[data-phase="details"]').waitFor({timeout:120000}),
      page.locator('.error-message').waitFor({timeout:120000}).then(async()=>{throw new Error(expected+': '+await page.locator('.error-message').innerText());})
    ]);
    const output=page.getByRole('combobox',{name:'Output format'});
    await output.locator('option[value="ZIP"]').waitFor({state:'attached',timeout:120000});
    await output.selectOption('ZIP');
    await page.getByRole('button',{name:'Convert',exact:true}).click();
    await Promise.race([
      page.getByRole('button',{name:'Download',exact:true}).waitFor({timeout:120000}),
      page.locator('.error-message').waitFor({timeout:120000}).then(async()=>{throw new Error(expected+': '+await page.locator('.error-message').innerText());})
    ]);
    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download',exact:true}).click();
    const zip=await readFile(await (await pending).path());
    const entries=await decodeZip(zip);
    assert.ok(entries.some(e=>!e.directory&&e.data.length>0),expected+' must retain non-empty content');
    console.log('PASS',expected,'-> ZIP',entries.map(e=>e.name).join(', '));
    await page.getByRole('button',{name:'New File'}).click();
  }
  const bomb=await readFile(new URL('./fixtures/phase9-zstd-bomb.zst',import.meta.url));
  await page.locator('input[type=file]').setInputFiles({name:'bomb.zst',mimeType:'application/zstd',buffer:bomb});
  await page.locator('[data-phase="details"]').waitFor();
  await page.waitForFunction(()=>document.querySelector('#conversion-note')?.textContent?.includes('64 MiB'),undefined,{timeout:60000});
  assert.deepEqual(await page.getByRole('combobox',{name:'Output format'}).locator('option').allTextContents(),['Unavailable']);
  console.log('PASS compressed ZSTD expansion bomb rejected before output options');

  assert.deepEqual(remote,[]);
  assert.deepEqual(posts,[]);
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
