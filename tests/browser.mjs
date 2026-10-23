import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { detectFormat } from '../src/lib/registry.ts';

// Uses an existing Playwright/browser installation; never downloads dependencies.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
const base = process.env.TEST_URL || 'http://localhost:5173';
const artifacts = 'artifacts/phase1';
await mkdir(artifacts, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [], externalRequests = [], uploads = [];
function observe(p) {
  p.setDefaultTimeout(45_000);
  p.on('pageerror', error => errors.push(error.message));
  p.on('request', r => {
    if (/^https?:/.test(r.url()) && !['localhost', '127.0.0.1'].includes(new URL(r.url()).hostname)) externalRequests.push(r.url());
    if (r.method() !== 'GET') uploads.push(r.method() + ' ' + r.url());
  });
}
observe(page);
await page.addInitScript(() => {
  window.workerStats = { active: 0, maxActive: 0, created: 0, terminated: 0, stages: [] };
  const NativeWorker = Worker;
  window.Worker = class extends NativeWorker {
    ended = false;
    constructor(...args) {
      super(...args);
      const s = window.workerStats;
      s.created++; s.active++; s.maxActive = Math.max(s.maxActive, s.active);
      this.addEventListener('message', e => { if (e.data.type === 'stage') s.stages.push(e.data.stage); });
    }
    postMessage(message, ...args) {
      if (message.type === 'convert' && window.failNextConversion) {
        window.failNextConversion = false;
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { type: 'error', message: 'Test encoder failure. Try again.' } })));
      } else super.postMessage(message, ...args);
    }
    terminate() {
      if (!this.ended) { this.ended = true; window.workerStats.active--; window.workerStats.terminated++; }
      super.terminate();
    }
  };
  window.liveUrls = new Set();
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = create(blob); window.liveUrls.add(url); return url; };
  URL.revokeObjectURL = url => { window.liveUrls.delete(url); revoke(url); };
});
const fixture = async ext => readFile(new URL(`./fixtures/swatch.${ext}`, import.meta.url));
const png = await fixture('png'), jpeg = await fixture('jpg'), webp = await fixture('webp');
const upload = (name = 'swatch.png', mimeType = 'image/png', buffer = png) => page.locator('input[type=file]').setInputFiles({ name, mimeType, buffer });
const phase = async (value, settle = true) => {
  await page.locator(`[data-phase="${value}"]`).waitFor();
  if (settle) await page.waitForTimeout(550);
};
const readyDetails = async () => {
  await phase('details');
  await page.waitForFunction(() => !!document.querySelector('select:not(:disabled)'));
  await page.getByRole('button', { name: 'Convert', exact: true }).waitFor();
};
const newFile = async () => { await page.getByRole('button', { name: 'New File' }).click(); await phase('upload'); };
async function download() {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const saved = await pending;
  const bytes = await readFile(await saved.path());
  return { name: saved.suggestedFilename(), bytes };
}
async function decode(bytes, mime) {
  if(mime==='image/tiff') {
    const {decodeTiff}=await import('../src/lib/adapters/tiff.ts');
    const {width,height,data}=decodeTiff(bytes);
    return {width,height,corners:[[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y])=>[...data.subarray((Math.floor(y*height)*width+Math.floor(x*width))*4,(Math.floor(y*height)*width+Math.floor(x*width))*4+4)])};
  }
  return page.evaluate(async ({ bytes, mime }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
    const pixel = (x, y) => [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
    const result = { width: bitmap.width, height: bitmap.height,
      corners: [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([x, y]) => pixel(x * bitmap.width, y * bitmap.height)) };
    bitmap.close(); return result;
  }, { bytes: [...bytes], mime });
}
const choose = async format => page.getByRole('combobox', { name: 'Output format' }).selectOption(format);
const convert = async () => { await page.getByRole('button', { name: 'Convert', exact: true }).click(); await phase('complete'); };
const again = async () => { await page.getByRole('button', { name: 'Convert Again' }).click(); await readyDetails(); };

try {
  await page.goto(base);
  await page.locator('[data-ready="true"]').waitFor();
  await page.locator('[data-surface]').evaluate(el => { window.originalSurface = el; });
  await page.screenshot({ path: `${artifacts}/upload.png` });
  const headerBefore = await page.locator('header').boundingBox();

  // Every input/output pair, including all three same-format re-encodes.
  for (const [input, ext, bytes] of [['PNG', 'png', png], ['JPEG', 'jpg', jpeg], ['WEBP', 'webp', webp]]) {
    await upload(`swatch.${ext}`, `image/${input === 'JPEG' ? 'jpeg' : input.toLowerCase()}`, bytes);
    await readyDetails();
    const choices = await page.getByRole('combobox', { name: 'Output format' }).locator('option').allTextContents();
    for (const required of ['PNG','JPEG','WEBP','BMP','ICO']) assert.ok(choices.includes(required));
    assert.ok(!choices.includes('SVG'));
    if (input === 'PNG') {
      assert.ok(Math.abs((await page.locator('header').boundingBox()).y - headerBefore.y) < 2);
      assert.equal(await page.evaluate(() => window.liveUrls.size), 1);
      await page.screenshot({ path: `${artifacts}/details.png` });
    }
    for (const output of ['PNG', 'JPEG', 'WEBP']) {
      console.log('BASE path',input,output);
      await choose(output);
      await convert();
      const saved = await download();
      const detected = detectFormat(saved.bytes);
      assert.equal(detected.id, output);
      assert.equal(saved.name, `swatch.${output === 'JPEG' ? 'jpg' : output.toLowerCase()}`);
      const pixels = await decode(saved.bytes, detected.mime);
      assert.deepEqual([pixels.width, pixels.height], [128, 80]);
      if (input !== 'JPEG') {
        const transparent = pixels.corners[3];
        if (output === 'JPEG') assert.ok(transparent.every(v => v >= 250), 'transparent JPEG background must be white');
        else {
          assert.equal(transparent[3], 0, 'PNG/WebP must retain full transparency');
          assert.ok(Math.abs(pixels.corners[2][3] - 128) <= 1, 'semi-transparency must survive');
        }
      }
      assert.ok(pixels.corners[0][0] > 180, 'red pixels must survive decoding/encoding');
      assert.equal(await page.evaluate(() => window.liveUrls.size), 2, 'thumbnail plus result URL only');
      assert.equal(await page.evaluate(() => window.workerStats.active), 0);
      if (input === 'PNG' && output === 'JPEG') {
        await writeFile(`${artifacts}/downloaded.jpg`, saved.bytes);
        await page.screenshot({ path: `${artifacts}/complete.png` });
      }
      await again();
      assert.equal(await page.getByRole('combobox', { name: 'Output format' }).inputValue(), output);
      assert.equal(await page.evaluate(() => window.liveUrls.size), 1, 'Convert Again releases only the output');
    }
  }
  assert.equal(await page.evaluate(() => document.querySelector('[data-surface]') === window.originalSurface), true);
  console.log('PASS all 9 real conversion paths, download bytes, MIME, re-decode, dimensions, transparency and JPEG white background');

  // Extended codecs use the same UI/worker lifecycle and real downloaded files.
  const { encodeBmp, decodeBmp } = await import('../src/lib/adapters/bmp.ts');
  const { icoFrames } = await import('../src/lib/adapters/ico.ts');
  const rgba = await page.evaluate(async bytes => {
    const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const c=new OffscreenCanvas(128,80),ctx=c.getContext('2d'); ctx.drawImage(bitmap,0,0); bitmap.close();
    return [...ctx.getImageData(0,0,128,80).data];
  },[...png]);
  const bmp = Buffer.from(encodeBmp({width:128,height:80,data:new Uint8ClampedArray(rgba)}));
  await upload(); await readyDetails(); await choose('ICO'); await convert(); const icon=await download(); await again();
  await writeFile(`${artifacts}/downloaded.ico`,icon.bytes);
  const iconFrames=icoFrames(icon.bytes);
  assert.deepEqual(iconFrames.map(f=>f.width),[16,32,48,256]);
  for (const f of iconFrames) {
    const decoded=await decode(icon.bytes.subarray(f.offset,f.offset+f.length),'image/png');
    assert.ok(decoded.corners[0][0]>180); assert.equal(decoded.corners[3][3],0);
  }
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 80"><rect width="64" height="40" fill="red"/><rect x="64" width="64" height="40" fill="blue"/><rect y="40" width="64" height="40" fill="green" fill-opacity="0.5"/></svg>');
  const avif=await fixture('avif');
  const capabilities={};
  for (const [input,ext,mime,bytes] of [['BMP','bmp','image/bmp',bmp],['ICO','ico','image/x-icon',icon.bytes],['AVIF','avif','image/avif',avif],['SVG','svg','image/svg+xml',svg],['GIF','gif','image/gif',await fixture('gif')],['TIFF','tiff','image/tiff',await fixture('tiff')]]) {
    await upload(`extended.${ext}`,mime,bytes); await readyDetails();
    const outputs=await page.getByRole('combobox',{name:'Output format'}).locator('option').allTextContents();
    assert.ok(!outputs.includes('SVG'));
    capabilities[input]=outputs;
    for (const output of outputs) {
      console.log('EXTENDED path',input,output);
      await choose(output); await convert(); const result=await download();
      assert.equal(detectFormat(result.bytes)?.id,output);
      const expected = output==='ICO' || input==='ICO' ? 256 : 128;
      let dimensions;
      if (output==='BMP') {
        const decoded=decodeBmp(result.bytes); dimensions=[decoded.width,decoded.height];
        if (input==='BMP') await writeFile(`${artifacts}/downloaded.bmp`,result.bytes);
        if (input==='BMP') assert.deepEqual([...decoded.data],rgba);
      } else if (output==='ICO') {
        const frames=icoFrames(result.bytes); assert.deepEqual(frames.map(f=>f.width),[16,32,48,256]);
        for (const f of frames) assert.equal((await decode(result.bytes.subarray(f.offset,f.offset+f.length),'image/png')).width,f.width);
        dimensions=[256,256];
      } else {
        const decoded=await decode(result.bytes,detectFormat(result.bytes).mime); dimensions=[decoded.width,decoded.height];
        assert.ok(decoded.corners[0][0]>170,`${input} → ${output} red pixels`);
        if (output!=='JPEG') {
          assert.equal(decoded.corners[3][3],0,`${input} → ${output} full transparency`);
          if (input!=='ICO' && input!=='GIF') assert.ok(Math.abs(decoded.corners[2][3]-128)<=2,`${input} → ${output} partial transparency`);
        }
      }
      assert.deepEqual(dimensions,[expected,input==='ICO' || output==='ICO' ? 256 : 80]);
      await again();
    }
    if (input==='ICO') {
      await page.getByRole('combobox',{name:'Source frame'}).selectOption('0');
      await choose('PNG'); await convert(); const selected=await download();
      assert.equal((await decode(selected.bytes,'image/png')).width,16);
      await again(); assert.equal(await page.getByRole('combobox',{name:'Source frame'}).inputValue(),'0');
      await page.setViewportSize({width:320,height:640}); await page.waitForTimeout(400);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:`${artifacts}/ico-mobile-details.png`,fullPage:true});
      await page.setViewportSize({width:1280,height:900});
    }
    assert.equal(await page.evaluate(()=>window.workerStats.active),0);
  }
  // Real 24-bit BI_RGB input with bottom-up row padding; alpha is intentionally opaque.
  const bmp24=Buffer.alloc(54+128*3*80); bmp24.write('BM'); bmp24.writeUInt32LE(bmp24.length,2); bmp24.writeUInt32LE(54,10);
  bmp24.writeUInt32LE(40,14); bmp24.writeInt32LE(128,18); bmp24.writeInt32LE(80,22); bmp24.writeUInt16LE(1,26); bmp24.writeUInt16LE(24,28);
  for (let y=0;y<80;y++) for (let x=0;x<128;x++) { const p=(y*128+x)*4, d=54+(79-y)*384+x*3; bmp24[d]=rgba[p+2]; bmp24[d+1]=rgba[p+1]; bmp24[d+2]=rgba[p]; }
  await upload('24bit.bmp','image/bmp',bmp24); await readyDetails(); await choose('PNG'); await convert();
  const opaque=await decode((await download()).bytes,'image/png'); assert.equal(opaque.corners[3][3],255); await again();
  for (const output of ['BMP','ICO','TIFF']) for (const [ext,mime,bytes] of [['png','image/png',png],['jpg','image/jpeg',jpeg],['webp','image/webp',webp]]) {
    await upload(`original.${ext}`,mime,bytes); await readyDetails(); await choose(output); await convert();
    const saved=await download(); assert.equal(detectFormat(saved.bytes)?.id,output);
    if(output==='TIFF') { const decoded=await decode(saved.bytes,'image/tiff'); assert.deepEqual([decoded.width,decoded.height],[128,80]); if(ext==='png') await writeFile(`${artifacts}/downloaded.tiff`,saved.bytes); }
    await again();
  }
  for (const body of ['<script>alert(1)</script>','<foreignObject/>','<image href="https://example.invalid/leak"/>','<rect fill="url(https://example.invalid/leak)"/>','<style>@import "https://example.invalid/leak";</style>']) {
    await upload('unsafe.svg','image/svg+xml',Buffer.from(`<svg width="128" height="80">${body}</svg>`));
    await page.locator('#conversion-note').filter({hasText:/SVG\/XML/}).waitFor();
    assert.ok(await page.getByRole('combobox',{name:'Output format'}).isDisabled());
  }
  assert.equal(await page.evaluate(()=>window.liveUrls.size),0);
  await writeFile(`${artifacts}/phase2-capabilities.json`,JSON.stringify(capabilities,null,2));
  console.log('PASS extended BMP/ICO/AVIF/SVG paths, frame sizes/selection, pixel roundtrip, SVG rejection and resource cleanup', JSON.stringify(capabilities));

  for (const format of ['JPEG', 'WEBP']) {
    await upload(); await readyDetails(); await choose(format);
    const setQuality = async key => { await page.getByRole('slider', { name: /Quality/ }).focus(); await page.keyboard.press(key); };
    await setQuality('Home'); await convert(); const low = await download();
    await again(); assert.equal(await page.getByRole('slider', { name: /Quality/ }).inputValue(), '1');
    await setQuality('End'); await convert(); const high = await download();
    assert.notDeepEqual(low.bytes, high.bytes, `${format} quality must change actual encoded data`);
    await again(); assert.equal(await page.getByRole('slider', { name: /Quality/ }).inputValue(), '100');
  }
  console.log('PASS actual JPEG/WebP quality changes and retained settings');

  // All eight EXIF transforms: ensure orientation is applied exactly once.
  const colors = pixel => pixel[0] > 100 && pixel[0] > pixel[1] * 2 ? 'R' : pixel[2] > 100 && pixel[2] > pixel[1] * 2 ? 'B' : pixel[1] > 40 && pixel[1] > pixel[0] * 2 ? 'G' : 'K';
  const expected = ['RBGK', 'BRKG', 'KGBR', 'GKRB', 'RGBK', 'GRKB', 'KBGR', 'BKRG'];
  for (let orientation = 1; orientation <= 8; orientation++) {
    const exif = Buffer.from([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,orientation,0,0,0,0,0,0,0]);
    await upload('oriented.jpg', 'image/jpeg', Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]));
    await readyDetails(); await choose('PNG'); await convert();
    const saved = await download();
    const decoded = await decode(saved.bytes, 'image/png');
    assert.deepEqual([decoded.width, decoded.height], orientation >= 5 ? [80, 128] : [128, 80]);
    assert.equal(decoded.corners.map(colors).join(''), expected[orientation - 1], `EXIF orientation ${orientation}`);
    await again();
  }
  console.log('PASS all 8 EXIF orientations, display dimensions and stripped orientation metadata');

  // Browser-scheduler failure injection lives only in this test, not in application code.
  await page.evaluate(() => { window.failNextConversion = true; });
  await page.getByRole('button', { name: 'Convert', exact: true }).click(); await phase('error');
  await page.screenshot({ path: `${artifacts}/error.png` });
  await page.getByRole('button', { name: 'Try again' }).click(); await phase('complete');
  await newFile();
  assert.equal(await page.evaluate(() => window.liveUrls.size), 0);
  console.log('PASS recoverable engine failure, retry, New File and URL cleanup');

  // Input methods, keyboard focus, rapid replacement, and validation recovery.
  await page.getByRole('button', { name: 'Drop file' }).focus();
  const chooser = page.waitForEvent('filechooser'); await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'keyboard.png', mimeType: 'image/png', buffer: png });
  await readyDetails();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'keyboard.png');
  await page.getByRole('button', { name: 'Remove file' }).click(); await phase('upload');
  await page.evaluate(bytes => {
    const t = new DataTransfer(); t.items.add(new File([new Uint8Array(bytes)], 'drop.png', { type: 'image/png' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: t, cancelable: true }));
  }, [...png]);
  assert.equal(await page.locator('[data-surface]').evaluate(el => el.classList.contains('dragging')), true);
  await page.evaluate(bytes => {
    const t = new DataTransfer(); t.items.add(new File([new Uint8Array(bytes)], 'drop.png', { type: 'image/png' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: t, cancelable: true }));
  }, [...png]);
  await readyDetails();
  await page.evaluate(bytes => {
    const t = new DataTransfer(); t.items.add(new File([new Uint8Array(bytes)], 'paste.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: t, cancelable: true }));
  }, [...png]);
  await readyDetails(); assert.equal(await page.locator('h2').textContent(), 'paste.png');
  const changePicker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Change file' }).click();
  await (await changePicker).setFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png });
  await readyDetails();
  await upload('first.png'); await upload('second.png'); await upload('last.png');
  await readyDetails(); assert.equal(await page.locator('h2').textContent(), 'last.png');
  assert.equal(await page.evaluate(() => window.workerStats.maxActive), 1);
  console.log('PASS keyboard picker/focus, drop, paste, change file and racing analysis responses');

  for (const [name, type, bytes, message] of [
    ['notes.txt', 'text/plain', Buffer.from('text'), /not supported/],
    ['broken.png', 'image/png', png.subarray(0, 40), /corrupt|truncated/],
    ['broken.jpg', 'image/jpeg', jpeg.subarray(0, jpeg.length - 2), /corrupt|truncated/],
    ['empty.png', 'image/png', Buffer.alloc(0), /not supported|empty/]
  ]) {
    await upload(name, type, bytes); await phase('details');
    await page.locator('#conversion-note').filter({ hasText: message }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Output format' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.locator('#conversion-note').filter({ hasText: message }).waitFor();
  }
  for(const [name,mimeType] of [['fake.jpg','image/png'],['fake.png','image/jpeg']]) {
    await upload(name,mimeType,png);await readyDetails();
    await page.getByText(/Compatibility warning:/).waitFor();
    await page.getByRole('combobox',{name:'Output format'}).selectOption('PNG');
    await page.getByRole('button',{name:'Convert',exact:true}).click();await phase('complete');
    assert.equal(detectFormat((await download()).bytes)?.id,'PNG');
    await page.getByRole('button',{name:'Convert Again'}).click();await readyDetails();
  }
  const hugeDimensions = Buffer.from(png); hugeDimensions.writeUInt32BE(1000000, 16);
  await upload('huge.png', 'image/png', hugeDimensions); await page.getByText(/memory budget/).waitFor();
  await upload('huge.png', 'image/png', Buffer.concat([png, Buffer.alloc(64 * 1024 ** 2)]));
  await page.getByText(/64 MiB/).waitFor();
  await upload('no-extension', '', png); await readyDetails();
  console.log('PASS unsupported input, spoofing, corruption, empty/oversized files and recovery');

  // A real high-entropy image makes native decoding/encoding expensive enough to cancel.
  const large = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(4000, 4000), ctx = canvas.getContext('2d');
    const data = ctx.createImageData(4000, 4000);
    let seed = 123456789;
    for (let i = 0; i < data.data.length; i += 4) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      data.data[i] = seed & 255; data.data[i + 1] = seed >>> 8 & 255; data.data[i + 2] = seed >>> 16 & 255; data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .85 });
    return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
  });
  await upload('large.jpg', 'image/jpeg', Buffer.from(large, 'base64')); await readyDetails(); await choose('PNG');
  await page.evaluate(() => {
    window.workerStats.stages = []; window.heavySamples = []; window.heavySampling = true;
    const sample = time => { const r = document.querySelector('[data-surface]').getBoundingClientRect(); window.heavySamples.push({ time, height: r.height }); if (window.heavySampling) requestAnimationFrame(sample); }; requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: 'Convert', exact: true }).evaluate(el => { el.click(); el.click(); el.click(); });
  await phase('progress', false);
  await page.getByRole('button', { name: 'Cancel' }).waitFor();
  await page.waitForFunction(() => document.querySelector('.surface-content')?.inert === false);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.surface-content')).opacity) > .98);
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), null);
  assert.equal(await page.locator('.percentage').count(), 0);
  await page.screenshot({ path: `${artifacts}/progress.png` });
  await page.getByRole('button', { name: 'Cancel' }).click({ force: true }); await readyDetails();
  const heavyMetrics = await page.evaluate(() => {
    window.heavySampling = false;
    const s = window.heavySamples, intervals = s.slice(1).map((v, i) => v.time - s[i].time).sort((a, b) => a - b);
    return { frames: s.length, medianMs: intervals[Math.floor(intervals.length / 2)], p95Ms: intervals[Math.floor(intervals.length * .95)], minHeight: Math.min(...s.map(v => v.height)) };
  });
  assert.ok(heavyMetrics.minHeight >= 140, 'the physical frame must not collapse while content exits');
  await writeFile(`${artifacts}/heavy-motion-metrics.json`, JSON.stringify(heavyMetrics, null, 2));
  console.log('HEAVY MOTION', JSON.stringify(heavyMetrics));
  await page.waitForTimeout(1300);
  assert.equal(await page.locator('[data-surface]').getAttribute('data-phase'), 'details');
  assert.equal(await page.evaluate(() => window.workerStats.active), 0);
  assert.ok((await page.evaluate(() => window.workerStats.stages)).includes('decoding'));
  assert.equal(await page.getByRole('combobox', { name: 'Output format' }).inputValue(), 'PNG');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel' }).click(); await readyDetails();
  assert.equal(await page.locator('[data-surface]').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  console.log('PASS real heavy-work cancellation, indeterminate progress, rapid starts, stale-result suppression and reduced-motion');

  await page.setViewportSize({ width: 320, height: 640 });
  await upload('large.jpg', 'image/jpeg', Buffer.from(large, 'base64')); await readyDetails(); await choose('PNG');
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await phase('progress', false);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.surface-content')).opacity) > .98 && document.querySelector('.surface-content')?.inert === false);
  await page.screenshot({ path: `${artifacts}/mobile-progress.png`, fullPage: true });
  await page.getByRole('button', { name: 'Cancel' }).click({ force: true }); await readyDetails();
  await upload('a-very-long-filename-'.repeat(12) + '.png'); await readyDetails();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${artifacts}/mobile-details.png`, fullPage: true });
  await choose('JPEG'); await convert();
  await page.screenshot({ path: `${artifacts}/mobile-complete.png`, fullPage: true });
  await newFile(); await page.screenshot({ path: `${artifacts}/mobile-upload.png`, fullPage: true });
  for (const width of [768, 375, 1024, 320]) {
    await page.setViewportSize({ width, height: 740 }); await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.samples = [];
    const end = performance.now() + 1000;
    const sample = time => {
      const r = document.querySelector('[data-surface]').getBoundingClientRect();
      window.samples.push({ time, width: r.width, x: r.x + r.width / 2, y: r.y + r.height / 2 });
      if (performance.now() < end) requestAnimationFrame(sample);
    }; requestAnimationFrame(sample);
  });
  await upload(); await readyDetails(); await page.waitForTimeout(500);
  const metrics = await page.evaluate(() => {
    const s = window.samples, intervals = s.slice(1).map((v, i) => v.time - s[i].time).sort((a, b) => a - b);
    return { frames: s.length, medianMs: intervals[Math.floor(intervals.length / 2)], p95Ms: intervals[Math.floor(intervals.length * .95)], intermediateWidths: new Set(s.filter(v => v.width > 285 && v.width < 555).map(v => Math.round(v.width))).size, centerDriftX: Math.max(...s.map(v => v.x)) - Math.min(...s.map(v => v.x)), centerDriftY: Math.max(...s.map(v => v.y)) - Math.min(...s.map(v => v.y)) };
  });
  assert.ok(metrics.intermediateWidths >= 5);
  assert.ok(metrics.centerDriftX < 2 && metrics.centerDriftY < 2);
  await writeFile(`${artifacts}/motion-metrics.json`, JSON.stringify(metrics, null, 2));
  console.log('MOTION', JSON.stringify(metrics));
  console.log('PASS 320px, tablet/resizing and unchanged physical surface morph');

  // Actual encoder fallback simulation inside a native worker: WebP must disappear.
  const limited = await browser.newPage(); observe(limited);
  await limited.addInitScript(() => {
    const Native = Worker;
    window.Worker = class extends Native {
      constructor(url, options) {
        const script = `import ${JSON.stringify(String(url))}; const encode = OffscreenCanvas.prototype.convertToBlob; OffscreenCanvas.prototype.convertToBlob = function(options) { return encode.call(this, ['image/webp','image/avif'].includes(options?.type) ? { ...options, type: 'image/png' } : options); };`;
        const wrapper = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
        super(wrapper, options); URL.revokeObjectURL(wrapper);
      }
    };
  });
  await limited.goto(base); await limited.locator('[data-ready="true"]').waitFor();
  await limited.locator('input[type=file]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
  await limited.waitForFunction(() => !!document.querySelector('select:not(:disabled)'));
  const limitedChoices=await limited.locator('select option').allTextContents();
  assert.ok(limitedChoices.includes('PNG') && limitedChoices.includes('JPEG'));
  assert.ok(!limitedChoices.includes('WEBP') && !limitedChoices.includes('AVIF'));
  await limited.close();
  console.log('PASS unsupported encoder PNG fallback is detected and unavailable output is hidden');

  const touch = await browser.newPage({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true }); observe(touch);
  await touch.goto(base); await touch.locator('[data-ready="true"]').waitFor();
  const picker = touch.waitForEvent('filechooser'); await touch.getByRole('button', { name: 'Drop file' }).tap();
  await (await picker).setFiles({ name: 'touch.png', mimeType: 'image/png', buffer: png });
  await touch.waitForFunction(() => !!document.querySelector('select:not(:disabled)'));
  await touch.getByRole('button', { name: 'Convert', exact: true }).tap();
  await touch.getByRole('button', { name: 'New File' }).tap();
  await touch.getByRole('button', { name: 'Drop file' }).waitFor(); await touch.close();
  assert.equal(await page.evaluate(() => window.workerStats.active), 0);
  assert.equal(await page.evaluate(() => window.workerStats.created === window.workerStats.terminated), true);
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []); assert.deepEqual(uploads, []);
  console.log('PASS emulated touch, no worker leaks, no page errors, no external HTTP requests and no uploads');
} catch (error) {
  await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true });
  console.error('PAGE ERRORS', errors);
  throw error;
} finally { await browser.close(); }
