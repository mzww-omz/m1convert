import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const browserName = process.env.BROWSER || 'chromium';
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
assert.ok(['chromium', 'firefox', 'webkit'].includes(browserName));
const executablePath = process.env[`PLAYWRIGHT_${browserName.toUpperCase()}_EXECUTABLE_PATH`] || (browserName === 'chromium' ? process.env.PLAYWRIGHT_EXECUTABLE_PATH : undefined);
const browser = await playwright[browserName].launch({ headless: true, executablePath });
const artifacts = `artifacts/utility/${browserName}`;
const page = await browser.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const png = await readFile(new URL('./fixtures/swatch.png', import.meta.url));
const wav = await readFile(new URL('./fixtures/tone.wav', import.meta.url));
const file = (name, buffer = png) => ({ name, mimeType: '', buffer });
const phase = async name => {
  await page.locator(`[data-phase=${name}]`).waitFor();
  await page.waitForFunction(() => !document.querySelector('.surface-content').inert);
  await page.waitForTimeout(400);
};
const settings = () => page.getByRole('button', { name: 'Settings', exact: true });
// Test-only scheduling/failure injection; all successful outputs still use the real engine.
await page.addInitScript(() => {
  const Native = Worker;
  window.Worker = class extends Native {
    postMessage(message, ...args) {
      if (message.type === 'convert' && window.failNextConversion) {
        window.failNextConversion = false;
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { type: 'error', message: 'Test encoder failure. Try again.' } })));
      } else if (message.type === 'convert' && window.holdConversion) {
        window.holdConversion = false;
        window.resumeConversion = () => super.postMessage(message, ...args);
      } else super.postMessage(message, ...args);
    }
  };
});
await mkdir(artifacts, { recursive: true });
try {
  await page.goto(process.env.TEST_URL || 'http://localhost:5173');
  await page.locator('[data-ready=true]').waitFor();
  await page.locator('[data-surface]').evaluate(el => window.originalSurface = el);
  await page.locator('input[type=file]').setInputFiles(file('swatch.png'));
  await phase('details');
  assert.equal(await settings().getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getByRole('slider').count(), 0, 'Advanced controls are collapsed by default');
  await settings().focus();
  const tooltipId = await settings().getAttribute('aria-describedby');
  await page.locator(`[id="${tooltipId}"]`).waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator(`[id="${tooltipId}"]`).isVisible(), false);
  await page.keyboard.press('Enter');
  assert.equal(await settings().getAttribute('aria-expanded'), 'true');
  await page.getByRole('combobox', { name: 'Output format' }).selectOption('JPEG');
  assert.ok(await page.getByRole('slider', { name: /Quality/ }).isVisible());
  await settings().click();
  assert.equal(await page.getByRole('slider').count(), 0);
  // Adding inputs uses the real picker and existing LOAD/analysis lifecycle.
  await page.locator('input[type=file]').setInputFiles(file('one.wav', wav));
  await phase('details');
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  await (await picker).setFiles(file('two.wav', wav));
  await phase('details');
  assert.equal(await page.locator('.batch-list li').count(), 2);
  const remove = page.getByRole('button', { name: 'Remove two.wav', exact: true });
  await remove.focus();
  const removeTip = page.locator(`[id="${await remove.getAttribute('aria-describedby')}"]`);
  const tipBox = await removeTip.boundingBox(), listBox = await page.locator('.batch-list').boundingBox();
  assert.ok(tipBox && listBox && tipBox.y >= listBox.y && tipBox.y + tipBox.height <= listBox.y + listBox.height, 'Last-row tooltip must not be clipped by the scrollable list');
  await page.keyboard.press('Enter');
  await phase('details');
  assert.equal(await page.locator('.batch-list li').count(), 0);
  assert.equal(await page.locator('h2').innerText(), 'one.wav');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'one.wav');
  assert.ok(await page.evaluate(() => document.querySelector('[data-surface]') === window.originalSurface));
  // Real batch ZIP, with no invented individual download actions.
  await page.locator('input[type=file]').setInputFiles([file('one.wav', wav), file('two.wav', wav)]);
  await phase('details');
  await page.getByRole('combobox', { name: 'Output format' }).selectOption('WAV');
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await phase('complete');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const saved = await pending;
  const { decodeZip } = await import('../src/lib/adapters/archive.ts');
  assert.deepEqual((await decodeZip(await readFile(await saved.path()))).map(e => e.name), ['1-one.wav', '2-two.wav']);
  const capture = async (size, state) => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${size}/${state} must not overflow`);
    await page.screenshot({ path: `${artifacts}/${size}-${state}.png`, fullPage: true });
    await page.locator('[data-surface]').screenshot({ path: `${artifacts}/${size}-${state}-surface.png` });
    assert.ok(await page.evaluate(() => document.querySelector('[data-surface]') === window.originalSurface));
    assert.ok(await page.locator('img.icon').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), 'Local SVGs are loaded');
    for (const button of await page.locator('button[aria-label]').all()) {
      const box = await button.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, 'Icon targets are at least 44px');
      const tip = await button.getAttribute('aria-describedby');
      if ((await button.getAttribute('class'))?.includes('icon-button')) {
        assert.ok(tip && await page.locator(`[id="${tip}"]`).count() === 1, 'Icon operation has an associated tooltip');
      }
    }
  };
  for (const [size, width, height] of [['desktop', 1280, 900], ['mobile', 320, 740]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: 'New File', exact: true }).click();
    await phase('upload');
    await capture(size, 'idle');
    const box = await page.locator('[data-surface]').boundingBox();
    assert.equal(box.width, box.height, 'Idle Surface is square');
    await page.getByRole('button', { name: 'Drop file' }).focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(file('swatch.png'));
    await phase('details');
    await page.getByRole('combobox', { name: 'Output format' }).selectOption('JPEG');
    if (await settings().getAttribute('aria-expanded') === 'true') await settings().click();
    await page.waitForTimeout(400);
    await capture(size, 'ready');
    await settings().click();
    await page.waitForTimeout(400);
    await capture(size, 'settings');
    await settings().click();
    await page.evaluate(() => { window.holdConversion = true; });
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await phase('progress');
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), null);
    assert.equal(await page.locator('.percentage').count(), 0);
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
    await capture(size, 'complete');
    await page.getByRole('button', { name: 'New File', exact: true }).click();
    await phase('upload');
    await page.locator('input[type=file]').setInputFiles([file('one.wav', wav), file('two.wav', wav)]);
    await phase('details');
    await capture(size, 'batch');
    await page.getByRole('combobox', { name: 'Output format' }).selectOption('WAV');
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await phase('complete');
    await capture(size, 'batch-complete');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Convert Again', exact: true }).click();
  await phase('details');
  assert.equal(await page.locator('[data-surface]').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await page.locator('input[type=file]').setInputFiles([file('first.png'), file('second.png')]);
  await phase('details');
  assert.ok(await page.getByText('Only the first file will be converted.', { exact: false }).isVisible());
  await page.getByRole('button', { name: 'Remove first.png', exact: true }).click();
  await phase('details');
  assert.equal(await page.locator('h2').innerText(), 'second.png');
  await page.locator('input[type=file]').setInputFiles(file('long-name-'.repeat(30) + '.png'));
  await phase('details');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('input[type=file]').setInputFiles(file('broken.png', Buffer.from('not an image')));
  await phase('details');
  assert.ok(await page.getByRole('combobox', { name: 'Output format' }).isDisabled());
  assert.ok(await page.getByRole('button', { name: 'Try again', exact: true }).isVisible());
  assert.deepEqual(errors, []);
  console.log(`PASS ${browserName} ${browser.version()}: all phases desktop/mobile, settings, batch ZIP, keyboard tooltips/Escape, real add/remove, retry, reduced motion, long names, validation and stable Surface`);
} finally { await browser.close(); }
