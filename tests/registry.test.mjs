import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formats, detectFormat, formatsFor, planConversion } from '../src/lib/registry.ts';
import { inspectFile, checkDimensions, LIMITS } from '../src/lib/image-format.ts';

export const fixture = async (extension, type = `image/${extension === 'jpg' ? 'jpeg' : extension}`, name = `swatch.${extension}`) => new File([await readFile(new URL(`./fixtures/swatch.${extension}`, import.meta.url))], name, { type });

test('content signatures, not claimed MIME or names, identify PNG/JPEG/WebP', async () => {
  for (const [ext, id] of [['png', 'PNG'], ['jpg', 'JPEG'], ['webp', 'WEBP']]) {
    const file = await fixture(ext);
    assert.equal(detectFormat(new Uint8Array(await file.arrayBuffer()))?.id, id);
    const info = await inspectFile(file);
    assert.equal(info.format, id);
    assert.equal(info.width, 128);
    assert.equal(info.height, 80);
  }
  assert.equal(detectFormat(new TextEncoder().encode('<svg></svg>'))?.id, 'SVG');
});

test('registry retains all nine original paths, including re-encoding', () => {
  assert.deepEqual(formats.slice(0,9).map(f => f.id), ['PNG', 'JPEG', 'WEBP', 'JXL', 'HEIC', 'AVIF', 'BMP', 'ICO', 'SVG']);
  assert.deepEqual(formatsFor('PNG', ['ZIP','TAR','GZIP']), []);
  for (const input of ['PNG', 'JPEG', 'WEBP']) {
    assert.deepEqual(formatsFor(input, ['PNG', 'JPEG', 'WEBP']), ['PNG', 'JPEG', 'WEBP']);
    for (const output of ['PNG', 'JPEG', 'WEBP']) assert.deepEqual(planConversion(input, output).steps, [{ adapter: 'canvas', input, output }]);
  }
  assert.deepEqual(formatsFor('PNG', ['PNG', 'JPEG']), ['PNG', 'JPEG']);
  assert.deepEqual(formatsFor('GIF', ['PNG']), ['PNG']);
  assert.deepEqual(formatsFor('PNG', ['GIF','SVG']), []);
  assert.throws(() => planConversion('PNG', 'SVG'), /not supported/);
});

test('conflicting labels are accepted but unsupported or truncated files are rejected', async () => {
  for(const [mime,name] of [['image/jpeg','fake.png'],['image/png','fake.jpg'],['image/png','fake.svg']])
    assert.equal((await inspectFile(await fixture('png',mime,name))).format,'PNG');
  assert.equal((await inspectFile(await fixture('png', '', 'no-extension'))).format, 'PNG');
  assert.equal((await inspectFile(await fixture('png', 'application/octet-stream'))).format, 'PNG');
  for (const contents of ['', 'GIF89a', 'RIFF1234WEBP', '\x89PNG']) await assert.rejects(inspectFile(new File([contents], 'unknown')), /supported|corrupt|empty/i);
  const png = await fixture('png');
  await assert.rejects(inspectFile(new File([await png.slice(0, 40).arrayBuffer()], 'broken.png')), /corrupt|truncated/i);
});

test('encoded size, pre-decode dimensions, decoded pixels and working memory are bounded', async () => {
  const huge = await fixture('png');
  Object.defineProperty(huge, 'size', { value: LIMITS.maxFileBytes + 1 });
  await assert.rejects(inspectFile(huge), /64 MiB/);
  assert.throws(() => checkDimensions(4000, 4000, 64 * 1024 ** 2), /memory/);
  const original = new Uint8Array(await (await fixture('png')).arrayBuffer());
  for (const [width, height] of [[Number.MAX_SAFE_INTEGER, 1], [8000, 8000], [0, 80]]) {
    const bytes = original.slice();
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width); view.setUint32(20, height);
    await assert.rejects(inspectFile(new File([bytes], 'huge.png')), /dimensions|pixels|memory/i);
  }
});

test('EXIF orientation changes display dimensions once, without changing encoded dimensions', async () => {
  const jpeg = new Uint8Array(await (await fixture('jpg')).arrayBuffer());
  // APP1, Exif, little-endian TIFF, one SHORT Orientation tag = 6.
  const exif = Uint8Array.from([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  const info = await inspectFile(new File([jpeg.slice(0, 2), exif, jpeg.slice(2)], 'oriented.jpg', { type: 'image/jpeg' }));
  assert.deepEqual([info.width, info.height, info.encodedWidth, info.encodedHeight, info.orientation], [80, 128, 128, 80, 6]);
});
