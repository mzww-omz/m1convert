import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {encodeZip,decodeZip} from '../src/lib/adapters/archive.ts';
import {encodePnm,decodePnm} from '../src/lib/adapters/pnm.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
const page=await browser.newPage({acceptDownloads:true});
page.setDefaultTimeout(45000);
const errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/^https?:/.test(r.url())&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());});
const enc=new TextEncoder(),entry=(name,data)=>({name,data:enc.encode(data),directory:false,mtime:0});
const ready=()=>page.waitForFunction(()=>document.querySelector('[data-phase=details]')&&[...document.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('Convert')&&!b.disabled));
async function upload(name,bytes,mimeType='application/octet-stream'){
	await page.locator('input[type=file]').setInputFiles({name,mimeType,buffer:Buffer.from(bytes)});
	await page.getByRole('heading',{name,exact:true}).waitFor();
	await ready();
}
async function convert(format){
	await page.getByRole('combobox',{name:'Output format'}).selectOption(format);
	await page.getByRole('button',{name:'Convert',exact:true}).click();
	await Promise.race([page.getByRole('button',{name:'Download',exact:true}).waitFor(),page.locator('.error-message').waitFor().then(async()=>{throw Error(await page.locator('.error-message').innerText());})]);
	const wait=page.waitForEvent('download');
	await page.getByRole('button',{name:'Download',exact:true}).click();
	const download=await wait,bytes=await readFile(await download.path());
	await page.getByRole('button',{name:'Convert Again'}).click();await ready();
	return {name:download.suggestedFilename(),bytes};
}
function makeAr(name,content){
	const data=enc.encode(content),field=(v,n)=>String(v).padEnd(n,' ');
	const h=enc.encode(field(name+'/',16)+field(0,12)+field(0,6)+field(0,6)+field('100644',8)+field(data.length,10)+'`\n');
	return Buffer.concat([enc.encode('!<arch>\n'),h,data,...(data.length%2?[enc.encode('\n')]:[])].map(x=>Buffer.from(x)));
}
try {
	await page.goto(process.env.TEST_URL||'http://127.0.0.1:5173/');
	await page.locator('[data-ready=true]').waitFor();
	await page.locator('[data-surface]').evaluate(el=>window.surface=el);
	const epub=await encodeZip([
		entry('mimetype','application/epub+zip'),
		entry('META-INF/container.xml','<container><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
		entry('OPS/book.opf','<package><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>'),
		entry('OPS/one.xhtml','<html><body><h1>Chapter</h1><p>Test &amp; proof.</p></body></html>')
	],false);
	await upload('novel.epub',epub,'application/epub+zip');
	assert.match(await page.locator('main').innerText(),/1 chapter/);
	const txt=await convert('TXT');
	assert.equal(txt.name,'novel.txt');assert.match(txt.bytes.toString('utf8'),/Chapter\n\nTest & proof/);
	console.log('PHASE11 EPUB → TXT',txt.bytes.length);
	const ppm=encodePnm({width:2,height:1,data:new Uint8ClampedArray([255,0,0,255,0,0,255,255])},'PPM');
	await upload('picture.ppm',ppm,'image/x-portable-pixmap');
	const png=await convert('PNG');
	assert.deepEqual([...png.bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
	console.log('PHASE11 PPM → PNG',png.bytes.length);
	await upload('picture.png',png.bytes,'image/png');
	const ppm2=await convert('PPM');
	assert.equal(decodePnm(ppm2.bytes).width,2);
	console.log('PHASE11 PNG → PPM',ppm2.bytes.length);
	for(const fmt of ['PGM','PBM']){
		const converted=await convert(fmt);
		assert.equal(decodePnm(converted.bytes).width,2);
		console.log('PHASE11 PNG →',fmt,converted.bytes.length);
	}
	const ar=makeAr('hello.txt','AR contents');
	await upload('legacy.a',ar,'application/x-archive');
	const zip=await convert('ZIP');
	const entries=await decodeZip(zip.bytes);
	assert.equal(entries.length,1);assert.equal(entries[0].name,'hello.txt');
	assert.equal(new TextDecoder().decode(entries[0].data),'AR contents');
	console.log('PHASE11 AR → ZIP',zip.bytes.length);
	await page.getByRole('button',{name:'Remove file'}).click();
	await page.locator('[data-phase=upload]').waitFor();
	assert.ok(await page.evaluate(()=>document.querySelector('[data-surface]')===window.surface));
	assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
	console.log('PASS Phase 11 ebook, Netpbm image and Unix ar browser paths');
} catch(e) {
	console.error(await page.locator('main').innerText().catch(()=>'<unavailable>'));
	throw e;
} finally {await browser.close();}
