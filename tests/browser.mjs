import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Use an existing Playwright installation; this project does not download browsers.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
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
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
