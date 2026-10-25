import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {detectFormat} from '../src/lib/registry.ts';
import {inspectFile} from '../src/lib/image-format.ts';

// Independent libheif/x265 HEVC fixture; override to verify a real camera photo.
const filePath=process.env.HEIC_FIXTURE||new URL('./fixtures/phase9-swatch.heic',import.meta.url),bytes=await readFile(filePath);
const info=await inspectFile(new File([bytes],'photo.heic',{type:'image/heic'}));
assert.equal(info.format,'HEIC');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage();
page.setDefaultTimeout(65000);
const errors=[],external=[],uploads=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{
	if(r.method()!=='GET')uploads.push(r.url());
	if(/^https?:/.test(r.url())&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());
});
try {
	await page.goto(process.env.TEST_URL||'http://localhost:5173');
	await page.locator('[data-ready=true]').waitFor();
	console.log('HEIC fixture parsed; uploading');
	await page.locator('input[type=file]').setInputFiles({name:'photo.heic',mimeType:'image/heic',buffer:bytes});
	await page.locator('[data-phase="details"]').waitFor();
	console.log('HEIC details visible; converting');
	await page.getByRole('combobox',{name:'Output format'}).selectOption('PNG');
	await page.getByRole('button',{name:'Convert',exact:true}).click();
	await Promise.race([
		page.getByRole('button',{name:'Download',exact:true}).waitFor(),
		page.locator('.error-message').waitFor().then(async()=>{throw Error(await page.locator('.error-message').innerText());})
	]);
	console.log('HEIC conversion completed; downloading');
	const pending=page.waitForEvent('download');
	await page.getByRole('button',{name:'Download',exact:true}).click();
	const output=await readFile(await (await pending).path());
	assert.equal(detectFormat(output)?.id,'PNG');
	const view=new DataView(output.buffer,output.byteOffset,output.byteLength);
	const result=[view.getUint32(16),view.getUint32(20)];
	assert.deepEqual(result,[info.width,info.height]);
	assert.deepEqual(errors,[]);assert.deepEqual(uploads,[]);assert.deepEqual(external,[]);
	console.log('PASS HEIC to PNG',info.width,info.height);
} finally {await browser.close();}
