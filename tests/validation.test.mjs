import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectFile, verifyOutput, LIMITS } from '../src/lib/image-format.ts';

const read = ext => readFile(new URL(`./fixtures/swatch.${ext}`, import.meta.url));

test('animated PNG/WebP are rejected instead of silently flattening the first frame', async () => {
  const png = await read('png');
  const actl = Buffer.alloc(20); actl.writeUInt32BE(8); actl.write('acTL', 4); actl.writeUInt32BE(2, 8);
  await assert.rejects(inspectFile(new File([png.subarray(0, 33), actl, png.subarray(33)], 'animated.png')), /Animated/);
  const webp = await read('webp'); webp[20] |= 2;
  await assert.rejects(inspectFile(new File([webp], 'animated.webp')), /Animated/);
});

test('untrusted EXIF offsets and malformed RIFF chunk lengths cannot reach native decoding', async () => {
  const jpeg = await read('jpg');
  const exif = Buffer.from([255,225,0,34,69,120,105,102,0,0,73,73,42,0,255,255,255,255,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  await assert.rejects(inspectFile(new File([jpeg.subarray(0, 2), exif, jpeg.subarray(2)], 'bad-exif.jpg')), /corrupt|truncated/);
  const webp = await read('webp'); webp.writeUInt32LE(0xffffffff, 16);
  await assert.rejects(inspectFile(new File([webp], 'bad-chunk.webp')), /corrupt|truncated/);
});

test('output inspection uses the output byte limit, not the smaller upload limit', async () => {
  const output=new File([await read('png')],'output.png',{type:'image/png'});
  Object.defineProperty(output,'size',{value:48*1024**2});
  await assert.rejects(inspectFile(output),/32 MiB/);
  assert.equal((await inspectFile(output,true)).width,128);
});

test('output budget rejects oversized encoder results without allocating a giant payload', async () => {
  const blob = new Blob([await read('png')], { type: 'image/png' });
  Object.defineProperty(blob, 'size', { value: LIMITS.maxOutputBytes + 1 });
  await assert.rejects(verifyOutput(blob, 'PNG'), /encode/);
});
