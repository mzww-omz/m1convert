import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {jxlInfo} from '../src/lib/adapters/jxl.ts';
import {detectFormat} from '../src/lib/registry.ts';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage();
const external=[],uploads=[],errors=[];
page.setDefaultTimeout(120000);
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{
	if(r.method()!=='GET')uploads.push(r.url());
	if(/^https?:/.test(r.url())&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());
});
const ready=async()=>{
	await page.locator('[data-phase="details"]').waitFor();
	await page.getByRole('combobox',{name:'Output format'}).waitFor();
	await page.waitForFunction(()=>!document.querySelector('select')?.disabled);
};
const convert=async output=>{
	await page.getByRole('combobox',{name:'Output format'}).selectOption(output);
	await page.getByRole('button',{name:'Convert',exact:true}).click();
	await Promise.race([
		page.getByRole('button',{name:'Download',exact:true}).waitFor({timeout:120000}),
		page.locator('.error-message').waitFor({timeout:120000}).then(async()=>{throw Error(await page.locator('.error-message').innerText());})
	]);
	const pending=page.waitForEvent('download');
	await page.getByRole('button',{name:'Download',exact:true}).click();
	return readFile(await (await pending).path());
};
try {
	await page.goto(process.env.TEST_URL||'http://localhost:5173');
	await page.locator('[data-ready=true]').waitFor();
	const png=await readFile(new URL('./fixtures/swatch.png',import.meta.url));
	await page.locator('input[type=file]').setInputFiles({name:'swatch.png',mimeType:'image/png',buffer:png});
	await ready();
	const outputs=await page.getByRole('combobox',{name:'Output format'}).locator('option').allTextContents();
	assert.ok(outputs.includes('JXL'),'WASM JXL encoder must be verified and advertised');
	const encoded=await convert('JXL');
	assert.equal(detectFormat(encoded)?.id,'JXL');
	assert.deepEqual(jxlInfo(encoded),{width:128,height:80});
	await page.getByRole('button',{name:'New File'}).click();
	await page.locator('input[type=file]').setInputFiles({name:'sample.jxl',mimeType:'image/jxl',buffer:encoded});
	await ready();
	const decoded=await convert('PNG');
	assert.equal(detectFormat(decoded)?.id,'PNG');
	const dims=await page.evaluate(async data=>{
		const image=await createImageBitmap(new Blob([new Uint8Array(data)],{type:'image/png'}));
		const r=[image.width,image.height];image.close();return r;
	},[...decoded]);
	assert.deepEqual(dims,[128,80]);
	assert.deepEqual(external,[]);assert.deepEqual(uploads,[]);assert.deepEqual(errors,[]);
	console.log('PASS JPEG XL encode/decode, detected signature, dimensions, no uploads, no external requests');
} finally {await browser.close();}
