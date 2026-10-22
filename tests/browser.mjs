import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Use an existing Playwright installation; this project does not download browsers.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
const externalRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== 'localhost' && new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url()); });
const base = process.env.TEST_URL || 'http://localhost:5173';
const artifacts = 'artifacts';
await mkdir(artifacts, { recursive: true });
const upload = (name = 'notes.txt', mimeType = 'text/plain', buffer = Buffer.from('A local file.')) => page.locator('input[type=file]').setInputFiles({ name, mimeType, buffer });
const phase = async value => {
  await page.locator(`[data-phase="${value}"]`).waitFor();
  await page.waitForTimeout(650);
};
try {
  await page.goto(base);
  await page.locator('[data-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Drop file' }).waitFor();
  await page.screenshot({ path: `${artifacts}/upload.png` });
  await page.locator('[data-surface]').evaluate(el => { window.originalSurface = el; });
  await upload();
  await phase('details');
  await page.getByRole('combobox', { name: 'Output format' }).selectOption('PDF');
  await page.screenshot({ path: `${artifacts}/details.png` });
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await phase('progress');
  await page.screenshot({ path: `${artifacts}/progress.png` });
  await phase('complete');
  assert.equal(await page.getByRole('button', { name: 'Download', exact: true }).isDisabled(), true);
  await page.screenshot({ path: `${artifacts}/complete.png` });
  await page.getByRole('button', { name: 'Convert Again' }).click();
  await phase('details');
  assert.equal(await page.getByRole('combobox', { name: 'Output format' }).inputValue(), 'PDF');
  assert.equal(await page.evaluate(() => document.querySelector('[data-surface]') === window.originalSurface), true);
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await phase('progress');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await phase('details');
  await page.waitForTimeout(2600);
  assert.equal(await page.locator('[data-surface]').getAttribute('data-phase'), 'details');
  await page.getByRole('button', { name: 'Remove file' }).click();
  await phase('upload');
  await page.getByRole('button', { name: 'Drop file' }).focus();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Drop file');
  console.log('PASS core flow, retained DOM, settings, cancellation, disabled demo download');

  // Keyboard file picker and a real native FileChooser handoff.
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'keyboard.txt', mimeType: 'text/plain', buffer: Buffer.from('keyboard') });
  await phase('details');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'keyboard.txt');
  await page.getByRole('button', { name: 'Remove file' }).click();
  await phase('upload');

  // Browser-dispatched file drag/drop and file clipboard events (not OS automation).
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['drop'], 'dropped.txt', { type: 'text/plain' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer, cancelable: true }));
  });
  assert.equal(await page.locator('[data-surface]').evaluate(el => el.classList.contains('dragging')), true);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['drop'], 'dropped.txt', { type: 'text/plain' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, cancelable: true }));
  });
  await phase('details');
  assert.equal(await page.locator('h2').textContent(), 'dropped.txt');
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['paste'], 'pasted.txt', { type: 'text/plain' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector('h2')?.textContent === 'pasted.txt');
  await page.getByRole('button', { name: 'Change file' }).click().then(async () => {
    await upload('replacement.txt');
  });
  await page.waitForFunction(() => document.querySelector('h2')?.textContent === 'replacement.txt');
  console.log('PASS keyboard picker, focus, drop, paste, change file');

  // Rapid input replacement and cancellation inside the morph window.
  await page.getByRole('button', { name: 'Remove file' }).click();
  await upload('first.txt');
  await upload('second.txt');
  await upload('last.txt');
  await phase('details');
  assert.equal(await page.locator('h2').textContent(), 'last.txt');
  await page.getByRole('button', { name: 'Convert', exact: true }).evaluate(el => { el.click(); el.click(); el.click(); });
  await page.waitForTimeout(130);
  await page.getByRole('button', { name: 'Cancel' }).evaluate(el => el.click());
  await phase('details');
  await page.waitForTimeout(2600);
  assert.equal(await page.locator('[data-surface]').getAttribute('data-phase'), 'details');
  console.log('PASS rapid repeated operations and mid-animation cancellation');

  await page.goto(`${base}/?demo=error`);
  await page.locator('[data-ready="true"]').waitFor();
  await upload();
  await phase('details');
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await phase('error');
  await page.screenshot({ path: `${artifacts}/error.png` });
  await page.getByRole('button', { name: 'Try again' }).click();
  await phase('complete');
  await page.getByRole('button', { name: 'New File' }).click();
  await phase('upload');
  console.log('PASS error, retry, new file');

  // Native asynchronous preview; quality remains stable through another run.
  const headerBeforePreview = await page.locator('header').boundingBox();
  await page.evaluate(() => {
    window.objectUrlsCreated = 0;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.objectUrlsCreated++; return create(blob); };
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await upload('sample.png', 'image/png', png);
  await phase('details');
  await page.getByRole('img', { name: 'Selected file preview' }).waitFor();
  await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1);
  await page.getByRole('slider', { name: /Quality/ }).focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => window.objectUrlsCreated), 1, 'settings must not recreate preview resources');
  const headerAfterPreview = await page.locator('header').boundingBox();
  assert.ok(Math.abs(headerAfterPreview.y - headerBeforePreview.y) < 2, 'preview must not move the page chrome');
  await page.screenshot({ path: `${artifacts}/image-details.png` });
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await phase('complete');
  await page.getByRole('button', { name: 'Convert Again' }).click();
  await phase('details');
  assert.equal(await page.getByRole('slider', { name: /Quality/ }).inputValue(), '99');
  assert.equal(await page.evaluate(() => window.objectUrlsCreated), 1, 'progress and re-conversion must reuse the input preview');
  await upload('broken.png', 'image/png', Buffer.from('not an image'));
  await page.getByText('Preview unavailable.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Convert', exact: true }).waitFor();
  console.log('PASS image preview, quality retention, corrupt-image recovery');

  await page.setViewportSize({ width: 320, height: 640 });
  await upload('a-very-long-filename-'.repeat(12) + '.txt');
  await phase('details');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${artifacts}/mobile-details.png`, fullPage: true });
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await phase('progress');
  await page.screenshot({ path: `${artifacts}/mobile-progress.png`, fullPage: true });
  await phase('complete');
  await page.screenshot({ path: `${artifacts}/mobile-complete.png`, fullPage: true });
  for (const width of [768, 375, 1024, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.getByRole('button', { name: 'New File' }).click();
  await phase('upload');
  await page.screenshot({ path: `${artifacts}/mobile-upload.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await upload();
  await page.waitForFunction(() => document.querySelector('[data-surface]')?.dataset.phase === 'details');
  assert.equal(await page.locator('[data-surface]').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await phase('details');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  console.log('PASS 320px, tablet, resizing, reduced-motion');

  // Represent a 5GB local file without allocating or reading its payload.
  await page.evaluate(() => {
    const file = new File([], 'large-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 5 * 1024 ** 3 });
    const transfer = new DataTransfer(); transfer.items.add(file);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true }));
  });
  await page.getByText('video/mp4', { exact: false }).waitFor();
  assert.ok((await page.locator('.meta').textContent()).includes('5 GB'));
  await page.getByRole('button', { name: 'Remove file' }).click();
  await phase('upload');

  // Observe actual geometry and rAF intervals, not just declared CSS durations.
  await page.evaluate(() => {
    window.samples = [];
    const end = performance.now() + 900;
    const sample = time => {
      const rect = document.querySelector('[data-surface]').getBoundingClientRect();
      window.samples.push({ time, width: rect.width, centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2 });
      if (performance.now() < end) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await upload();
  await phase('details');
  await page.waitForTimeout(300);
  const metrics = await page.evaluate(() => {
    const samples = window.samples;
    const intervals = samples.slice(1).map((s, i) => s.time - samples[i].time).sort((a, b) => a - b);
    return { frames: samples.length, medianMs: intervals[Math.floor(intervals.length / 2)], p95Ms: intervals[Math.floor(intervals.length * .95)], intermediateWidths: new Set(samples.filter(s => s.width > 285 && s.width < 555).map(s => Math.round(s.width))).size, centerDriftX: Math.max(...samples.map(s => s.centerX)) - Math.min(...samples.map(s => s.centerX)), centerDriftY: Math.max(...samples.map(s => s.centerY)) - Math.min(...samples.map(s => s.centerY)) };
  });
  assert.ok(metrics.intermediateWidths >= 5, 'surface must physically morph, not jump/fade');
  assert.ok(metrics.centerDriftX < 2 && metrics.centerDriftY < 2, 'desktop center must stay fixed');
  await import('node:fs/promises').then(fs => fs.writeFile(`${artifacts}/motion-metrics.json`, JSON.stringify(metrics, null, 2)));
  console.log('MOTION', JSON.stringify(metrics));
  const touchPage = await browser.newPage({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
  touchPage.on('pageerror', error => errors.push(error.message));
  await touchPage.goto(base);
  await touchPage.locator('[data-ready="true"]').waitFor();
  const touchChooser = touchPage.waitForEvent('filechooser');
  await touchPage.getByRole('button', { name: 'Drop file' }).tap();
  await (await touchChooser).setFiles({ name: 'touch.txt', mimeType: 'text/plain', buffer: Buffer.from('touch') });
  await touchPage.getByRole('button', { name: 'Convert', exact: true }).tap();
  await touchPage.getByRole('button', { name: 'Cancel' }).tap();
  await touchPage.getByRole('button', { name: 'Remove file' }).tap();
  await touchPage.getByRole('button', { name: 'Drop file' }).waitFor();
  await touchPage.close();
  console.log('PASS emulated touch picker, convert, cancel, remove');
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log('PASS zero page errors and zero external HTTP requests');
} finally {
  await browser.close();
}
