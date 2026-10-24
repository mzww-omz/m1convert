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
  // Round-trip newly supported compressed TAR outputs in the browser.
  const rar3=await readFile(new URL('./fixtures/phase9-sample-rar3.rar',import.meta.url));
  for(const [format,extension,signature] of [
    ['TAR.XZ','tar.xz',[0xfd,0x37,0x7a,0x58,0x5a]],
    ['TAR.BZ2','tar.bz2',[0x42,0x5a,0x68]]
  ].filter(([format])=>!process.env.PHASE9_WRITE_FORMAT||process.env.PHASE9_WRITE_FORMAT===format)) {
    await page.locator('input[type=file]').setInputFiles({name:'test.rar',mimeType:'application/octet-stream',buffer:rar3});
    await page.locator('[data-phase="details"]').waitFor();
    const output=page.getByRole('combobox',{name:'Output format'});
    await output.locator('option[value="'+format+'"]').waitFor({state:'attached',timeout:60000});
    await output.selectOption(format);
    await page.getByRole('button',{name:'Convert',exact:true}).click();
    await Promise.race([
      page.getByRole('button',{name:'Download',exact:true}).waitFor({timeout:120000}),
      page.locator('.error-message').waitFor({timeout:120000}).then(async()=>{throw new Error(format+': '+await page.locator('.error-message').innerText());})
    ]);
    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download',exact:true}).click();
    const tar=await readFile(await (await pending).path());
    assert.deepEqual([...tar.subarray(0,signature.length)],signature,format+' signature');
    await page.getByRole('button',{name:'New File'}).click();

    await page.locator('input[type=file]').setInputFiles({name:'reopened.'+extension,mimeType:'application/octet-stream',buffer:tar});
    await page.locator('[data-phase="details"]').waitFor();
    await page.getByRole('combobox',{name:'Output format'}).selectOption('ZIP');
    await page.getByRole('button',{name:'Convert',exact:true}).click();
    await Promise.race([
      page.getByRole('button',{name:'Download',exact:true}).waitFor({timeout:120000}),
      page.locator('.error-message').waitFor({timeout:120000}).then(async()=>{throw new Error(format+' round-trip: '+await page.locator('.error-message').innerText());})
    ]);
    const downloaded=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download',exact:true}).click();
    const entries=await decodeZip(await readFile(await (await downloaded).path()));
    assert.equal(entries.length,1);
    assert.equal(entries[0].name,'testfile.txt');
    assert.ok(entries[0].data.length>0);
    console.log('PASS RAR3 -> '+format+' -> ZIP',entries[0].name,entries[0].data.length,'bytes');
    await page.reload();
    await page.locator('[data-ready=true]').waitFor();
  }
  // The WASM writer does not preserve explicit directory records.
  const withDirectories=await readFile(new URL('./fixtures/phase9-sample.tar.xz',import.meta.url));
  await page.locator('input[type=file]').setInputFiles({name:'directories.tar.xz',mimeType:'application/x-xz',buffer:withDirectories});
  await page.locator('[data-phase="details"]').waitFor();
  for(const format of ['TAR.XZ','TAR.BZ2']) assert.equal(await page.getByRole('combobox',{name:'Output format'}).locator('option[value="'+format+'"]').count(),0);
  console.log('PASS compressed TAR output disabled for explicit directory records');

  assert.deepEqual(remote,[]);
  assert.deepEqual(posts,[]);
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
