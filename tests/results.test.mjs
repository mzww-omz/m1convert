import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResultManager, outputName } from '../src/lib/results.ts';

test('output names use real encoder extensions and discard path/control characters', () => {
  assert.equal(outputName('photo.jpeg', 'JPEG'), 'photo.jpg');
  assert.equal(outputName('archive.tar.png', 'WEBP'), 'archive.tar.webp');
  assert.equal(outputName('README', 'PNG'), 'README.png');
  assert.equal(outputName('../bad\\photo\u0000.png', 'PNG'), 'photo_.png');
  assert.equal(outputName('.png', 'PNG'), 'converted.png');
  for (const format of ['BMP','ICO','AVIF']) assert.equal(outputName('input.png', format), `input.${format.toLowerCase()}`);
  assert.throws(() => outputName('input.png', 'GIF'), /supported/);
});

test('result replacement and clear release Blob URLs; clearing twice is safe', async () => {
  const manager = new ResultManager();
  const first = new Blob(['first']);
  manager.set({ blob: first, name: 'first.png' });
  const url = manager.url;
  assert.equal(await (await fetch(url)).text(), 'first');
  manager.set({ blob: new Blob(['second']), name: 'second.png' });
  await assert.rejects(fetch(url));
  const second = manager.url;
  assert.equal(await (await fetch(second)).text(), 'second');
  manager.clear();
  manager.clear();
  assert.equal(manager.url, '');
  await assert.rejects(fetch(second));
});
