import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless:true, executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport:{ width:1280,height:900 } });
page.setDefaultTimeout(60000);
const errors=[],external=[],uploads=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('request',r=>{
	if(/^https?:/.test(r.url())&&!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());
	if(r.method()!=='GET')uploads.push(r.url());
});
await page.addInitScript(()=>{
	const W=Worker;window.workers=0;window.liveUrls=new Set();
	window.Worker=class extends W {done=false;constructor(...args){super(...args);window.workers++;}terminate(){if(!this.done){this.done=true;window.workers--;}super.terminate();}};
	const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
	URL.createObjectURL=b=>{const url=create(b);window.liveUrls.add(url);return url;};
	URL.revokeObjectURL=url=>{window.liveUrls.delete(url);revoke(url);};
});
await mkdir('artifacts/video',{recursive:true});
const fixture=async ext=>({name:'sample.'+ext,mimeType:'',buffer:await readFile(new URL('./fixtures/video/sample.'+ext,import.meta.url))});
const output=()=>page.getByRole('combobox',{name:'Output format'});
const ready=async()=>{
	await page.waitForFunction(()=>{
		const el=document.querySelector('.surface-content');
		const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Convert'));
		return document.querySelector('[data-phase=details]')&&el&&!el.classList.contains('hidden')&&b&&!b.disabled;
	});
};
async function upload(f){
	await page.locator('input[type=file]').setInputFiles(f);
	await page.getByRole('heading',{name:f.name,exact:true}).waitFor();
	await Promise.race([ready(),page.locator('#conversion-note').filter({hasText:/unavailable|cannot|not supported|failed|error/i}).waitFor().then(async()=>{throw Error(await page.locator('#conversion-note').innerText());})]);
}
async function convert(format,mode,codec){
	await output().selectOption(format);
	if(mode)await page.getByRole('combobox',{name:'Processing'}).selectOption(mode);
	if(codec)await page.getByRole('combobox',{name:'Video codec'}).selectOption(codec);
	await page.getByRole('button',{name:'Convert',exact:true}).click();
	await Promise.race([page.getByRole('button',{name:'Download',exact:true}).waitFor({timeout:120000}),page.locator('.error-message').waitFor({timeout:120000}).then(async()=>{throw Error(await page.locator('.error-message').innerText());})]);
	const pending=page.waitForEvent('download');
	await page.getByRole('button',{name:'Download',exact:true}).click();
	const d=await pending,path='artifacts/video/'+d.suggestedFilename();
	await d.saveAs(path);
	const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8'});
	assert.equal(probe.status,0,probe.stderr);
	const result=JSON.parse(probe.stdout);
	assert.equal(result.streams.filter(x=>x.codec_type==='video').length,1);
	assert.equal(result.streams.filter(x=>x.codec_type==='audio').length,1);
	assert.ok(+result.format.duration>1.7&&+result.format.duration<2.3);
	assert.equal(await page.evaluate(()=>window.workers),0);
	await page.getByRole('button',{name:'Convert Again'}).click();await ready();
	console.log('VIDEO',format,mode??'auto',codec??'auto',result.streams.map(x=>x.codec_name).join('/'));
	return result;
}
try {
	await page.goto(process.env.TEST_URL||'http://127.0.0.1:5173/');
	await page.locator('[data-ready=true]').waitFor();
	await page.locator('[data-surface]').evaluate(el=>window.originalSurface=el);
	await upload(await fixture('mp4'));
	const options=await output().locator('option').evaluateAll(opts=>opts.map(o=>o.value));
	assert.ok(options.includes('MP4')&&options.includes('MKV'));
	await output().selectOption('WEBM');
	await page.getByRole('combobox',{name:'Processing'}).selectOption('remux');
	await page.getByRole('button',{name:'Convert',exact:true}).click();
	await page.locator('.error-message').waitFor();
	assert.match(await page.locator('.error-message').innerText(),/Lossless remux|cannot|incompatible/i);
	await page.getByRole('button',{name:'Back to details'}).click();
	await ready();
	let r=await convert('MKV','remux');
	assert.equal(r.streams[0].codec_name,'h264');
	assert.equal(r.streams[1].codec_name,'aac');
	if(options.includes('WEBM')) {
		r=await convert('WEBM','auto');
		assert.equal(r.streams[0].codec_name,'vp9');
		assert.equal(r.streams[1].codec_name,'opus');
	}
	r=await convert('MP4','transcode','avc');
	assert.equal(r.streams[0].codec_name,'h264');
	await upload(await fixture('webm'));
	const webmChoices=await output().locator('option').evaluateAll(opts=>opts.map(o=>o.value));
	assert.ok(webmChoices.includes('MP4'),'WebM to MP4 must be available in tested Chromium');
	r=await convert('MP4','auto');
	assert.equal(r.streams[0].codec_name,'h264');
	assert.equal(r.streams[1].codec_name,'opus');
	await upload(await fixture('mov'));
	assert.ok(await output().locator('option[value="MOV"]').count());
	await upload(await fixture('mkv'));
	assert.ok(await output().locator('option[value="MKV"]').count());
	await page.locator('input[type=file]').setInputFiles({name:'multiple-audio.mkv',mimeType:'',buffer:await readFile(new URL('./fixtures/video/sample-multiaudio.mkv',import.meta.url))});
	await page.locator('#conversion-note').filter({hasText:/no subtitle|no subtitle\/data|no subtitle\/data tracks/i}).waitFor();
	assert.match(await page.locator('#conversion-note').innerText(),/no subtitle\/data tracks/i);
	await upload({name:'misnamed.mp3',mimeType:'audio/mpeg',buffer:await readFile(new URL('./fixtures/video/sample.mp4',import.meta.url))});
	assert.ok(await output().locator('option[value="WEBM"]').count());
	assert.match(await page.locator('main').innerText(),/video\/mp4/);
	await page.getByRole('button',{name:'Remove file'}).click();
	await page.locator('[data-phase=upload]').waitFor();
	assert.equal(await page.evaluate(()=>window.document.querySelector('[data-surface]')===window.originalSurface),true);
	assert.equal(await page.evaluate(()=>window.liveUrls.size),0);
	await page.waitForFunction(async()=>{
		if(!navigator.storage?.getDirectory)return true;
		const root=await navigator.storage.getDirectory();
		const dir=await root.getDirectoryHandle('convert-temporary',{create:true});
		for await(const [name] of dir.entries())if(name.startsWith('convert-'))return false;
		return true;
	},{timeout:15000});
	assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(uploads,[]);
	console.log('PASS Phase 10 video remux/transcode, incompatible remux, multitrack rejection, MIME sniffing, FFprobe, cleanup');
} catch(e){
	console.error('PAGE',await page.locator('main').innerText());
	throw e;
} finally {await browser.close();}
