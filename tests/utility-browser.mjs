import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const browserName = process.env.BROWSER || 'chromium';
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
assert.ok(['chromium', 'firefox', 'webkit'].includes(browserName));
const executablePath = process.env[`PLAYWRIGHT_${browserName.toUpperCase()}_EXECUTABLE_PATH`] || (browserName === 'chromium' ? process.env.PLAYWRIGHT_EXECUTABLE_PATH : undefined);
const browser = await playwright[browserName].launch({ headless: true, executablePath });
const artifacts = `artifacts/restored-ui/${browserName}`;
const page = await browser.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const png = await readFile(new URL('./fixtures/swatch.png', import.meta.url));
const wav = await readFile(new URL('./fixtures/tone.wav', import.meta.url));
const zip = await readFile(new URL('./fixtures/deflated.zip', import.meta.url));
const file = (name, buffer = png, mimeType = '') => ({ name, mimeType, buffer });
const phase = async name => {
  await page.locator(`[data-phase=${name}]`).waitFor();
  await page.waitForFunction(() => !document.querySelector('.surface-content').inert);
  await page.waitForTimeout(400);
};
// Test-only scheduling/failure injection; successful outputs use the real engine.
await page.addInitScript(() => {
  const Native = Worker;
  window.Worker = class extends Native {
    postMessage(message, ...args) {
      if (message.type === 'convert' && window.failNextConversion) {
        window.failNextConversion = false;
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { type: 'error', message: 'Test encoder failure. Try again.' } })));
      } else if (message.type === 'convert' && window.holdConversion) {
        window.holdConversion = false;
      } else super.postMessage(message, ...args);
    }
  };
});
await mkdir(artifacts, { recursive: true });
const icon = () => page.locator('.filename-with-icon > img.icon');
const expectIcon = async name => {
  assert.ok((await icon().getAttribute('src')).endsWith(`/icons/${name}.svg`));
  assert.equal(await icon().getAttribute('aria-hidden'), 'true');
  assert.equal(await icon().getAttribute('width'), '16');
  assert.ok(await icon().evaluate(image => image.complete && image.naturalWidth > 0));
};
try {
  await page.goto(process.env.TEST_URL || 'http://localhost:5173');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-surface]').evaluate(el => window.originalSurface = el);
  const capture = async (size, state) => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${size}/${state} must not overflow`);
    assert.ok(await page.evaluate(() => document.querySelector('[data-surface]') === window.originalSurface));
    assert.equal(await page.locator('button .icon').count(), 0, 'Operations remain text-based');
    await page.screenshot({ path: `${artifacts}/${size}-${state}.png`, fullPage: true });
  };
  for (const [size, width, height] of [['desktop', 1280, 900], ['mobile', 320, 740]]) {
    await page.setViewportSize({ width, height });
    if (size === 'mobile') await page.getByRole('button', { name: 'New File', exact: true }).click();
    await phase('upload');
    const box = await page.locator('[data-surface]').boundingBox();
    assert.equal(box.width, 282, 'Original 280px upload Surface plus borders');
    assert.ok(Math.abs(box.width - box.height) < 0.01, 'Idle Surface remains square within subpixel rounding');
    assert.equal(await page.locator('[data-surface]').evaluate(el => getComputedStyle(el).borderRadius), '3px');
    assert.equal(await page.locator('header .icon').count(), 0);
    await capture(size, 'idle');
    await page.getByRole('button', { name: 'Drop file' }).focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(file('swatch.png'));
    await phase('details');
    await expectIcon('image');
    await page.getByRole('combobox', { name: 'Output format' }).selectOption('JPEG');
    assert.ok(await page.getByRole('slider', { name: /Quality/ }).isVisible(), 'Original settings remain directly visible');
    assert.equal((await page.getByRole('button', { name: 'Remove file' }).innerText()).trim(), 'Remove');
    await capture(size, 'ready');
    await page.evaluate(() => { window.holdConversion = true; });
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await phase('progress');
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), null);
    assert.equal(await page.locator('.percentage').count(), 0);
    assert.equal((await page.getByRole('button', { name: 'Cancel', exact: true }).innerText()).trim(), 'Cancel');
    await capture(size, 'processing');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await phase('details');
    await page.evaluate(() => { window.failNextConversion = true; });
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await phase('error');
    assert.match(await page.locator('.error-message').innerText(), /Test encoder failure/);
    await capture(size, 'error');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await phase('complete');
    await expectIcon('image');
    assert.equal((await page.getByRole('button', { name: 'Download', exact: true }).innerText()).trim(), 'Download');
    await capture(size, 'complete');
    await page.getByRole('button', { name: 'New File', exact: true }).click();
    await phase('upload');
    await page.locator('input[type=file]').setInputFiles([file('one.wav', wav), file('two.wav', wav)]);
    await phase('details');
    await expectIcon('audio_file');
    assert.ok(await page.getByRole('combobox', { name: 'Sample rate', exact: true }).isVisible());
    assert.ok(await page.getByText(/2 files selected/).isVisible());
    await capture(size, 'batch');
    await page.getByRole('combobox', { name: 'Output format' }).selectOption('WAV');
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await phase('complete');
    await expectIcon('folder_zip');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const saved = await pending;
    const { decodeZip } = await import('../src/lib/adapters/archive.ts');
    assert.deepEqual((await decodeZip(await readFile(await saved.path()))).map(e => e.name), ['1-one.wav', '2-two.wav']);
    await capture(size, 'batch-complete');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Convert Again', exact: true }).click();
  await phase('details');
  assert.equal(await page.locator('[data-surface]').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  for (const [input, expected] of [
    [file('archive.zip', zip), 'folder_zip'],
    [file('clip.mp4', Buffer.from('unsupported video'), 'video/mp4'), 'video_file'],
    [file('notes.pdf', Buffer.from('unsupported document'), 'application/pdf'), 'draft']
  ]) {
    await page.locator('input[type=file]').setInputFiles(input);
    await phase('details');
    await expectIcon(expected);
  }
  await page.locator('input[type=file]').setInputFiles(file('long-name-'.repeat(30) + '.png'));
  await phase('details');
  await expectIcon('image');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('input[type=file]').setInputFiles(file('broken.png', Buffer.from('not an image')));
  await phase('details');
  assert.ok(await page.getByRole('combobox', { name: 'Output format' }).isDisabled());
  assert.ok(await page.getByRole('button', { name: 'Try again', exact: true }).isVisible());
  assert.deepEqual(errors, []);
  console.log(`PASS ${browserName} ${browser.version()}: restored text UI, original Surface dimensions, file-type icons, desktop/mobile states, keyboard, real batch ZIP, Cancel/retry, reduced motion and validation`);
} finally { await browser.close(); }
