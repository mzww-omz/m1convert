import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectFile } from '../src/lib/image-format.ts';
import { detectFormat, planConversion } from '../src/lib/registry.ts';

const pixel = new Uint8ClampedArray([255,0,0,255, 0,0,255,128, 0,255,0,0, 1,2,3,255]);
test('BMP RGBA round-trip, 24-bit padding, row order and explicit rejection', async () => {
  const { encodeBmp, decodeBmp, bmpInfo } = await import('../src/lib/adapters/bmp.ts');
  const bytes = encodeBmp({ width: 2, height: 2, data: pixel });
  assert.equal(detectFormat(bytes)?.id, 'BMP');
  assert.deepEqual(decodeBmp(bytes).data, pixel);
  assert.deepEqual([bmpInfo(bytes).width, bmpInfo(bytes).height], [2,2]);
  // 24-bit bottom-up rows, each padded to four bytes.
  const b = new Uint8Array(62), v = new DataView(b.buffer);
  b.set([66,77]); v.setUint32(2,62,true); v.setUint32(10,54,true); v.setUint32(14,40,true);
  v.setInt32(18,1,true); v.setInt32(22,2,true); v.setUint16(26,1,true); v.setUint16(28,24,true);
  b.set([255,0,0,0,0,0,255,0],54);
  assert.deepEqual([...decodeBmp(b).data], [255,0,0,255,0,0,255,255]);
  v.setInt32(22,-2,true);
  assert.deepEqual([...decodeBmp(b).data], [0,0,255,255,255,0,0,255]);
  v.setUint32(30,1,true); assert.throws(() => bmpInfo(b), /compression/i);
  v.setUint32(30,0,true); v.setUint16(28,8,true); assert.throws(() => bmpInfo(b), /24|32/);
  assert.throws(() => bmpInfo(bytes.subarray(0,60)), /corrupt|truncated/i);
});

test('ICO directory preserves all frames and rejects offsets, counts and dimensions', async () => {
  const { encodeIco, icoFrames } = await import('../src/lib/adapters/ico.ts');
  const png = new Uint8Array(await readFile(new URL('./fixtures/swatch.png', import.meta.url)));
  const bytes = encodeIco([{ width:128, height:80, bytes:png }, { width:128, height:80, bytes:png }]);
  assert.equal(detectFormat(bytes)?.id, 'ICO');
  assert.equal(icoFrames(bytes).length,2);
  const info = await inspectFile(new File([bytes], 'test.ico', { type:'image/x-icon' }));
  assert.equal(info.frames.length,2);
  const bad = bytes.slice(); new DataView(bad.buffer).setUint32(18,0xffffffff,true);
  assert.throws(() => icoFrames(bad), /ICO|corrupt/i);
  const mismatch = bytes.slice(); mismatch[6]=16;
  await assert.rejects(inspectFile(new File([mismatch], 'test.ico')), /dimension|ICO/i);
  const count = bytes.slice(); count[4]=0; assert.throws(() => icoFrames(count), /ICO/i);
});

test('SVG allowlist rejects active content, references, CSS, entities and malformed XML', async () => {
  const { svgInfo } = await import('../src/lib/adapters/svg.ts');
  const encode = s => new TextEncoder().encode(s);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10" fill="red"/></svg>';
  assert.equal(detectFormat(encode(svg))?.id,'SVG');
  assert.deepEqual([svgInfo(encode(svg)).width, svgInfo(encode(svg)).height], [20,10]);
  assert.equal(svgInfo(encode(svg.replace('viewBox=', 'width="40" viewBox='))).height,20);
  for (const body of ['<script/>','<foreignObject/>','<image href="https://example.invalid/x"/>','<rect onclick="alert(1)"/>','<style>rect{fill:url(https://x)}</style>','<rect style="fill:red"/>','<use href="#x"/>','<rect fill="url(https://x)"/>','<rect fill="&#114;ed"/>','<g></svg>']) {
    assert.throws(() => svgInfo(encode(`<svg width="10" height="10">${body}</svg>`)), /SVG|XML/i,body);
  }
  assert.throws(() => svgInfo(encode('<!DOCTYPE svg [<!ENTITY x "hi">]><svg/>')), /SVG|XML/i);
});

test('AVIF signatures and bounded BMFF metadata reject sequences and truncation', async () => {
  const box = (type, data) => { const b=Buffer.alloc(8+data.length); b.writeUInt32BE(b.length); b.write(type,4); b.set(data,8); return b; };
  const ftyp=box('ftyp',Buffer.from('avif\0\0\0\0avif'));
  const ispe=Buffer.alloc(12); ispe.writeUInt32BE(2,4); ispe.writeUInt32BE(3,8);
  const meta=box('meta',Buffer.concat([Buffer.alloc(4),box('iprp',box('ipco',Buffer.concat([box('ispe',ispe),box('av1C',Buffer.from([129,0,0,0]))])))]));
  const bytes=Buffer.concat([ftyp,meta,box('mdat',Buffer.from([1]))]);
  assert.equal(detectFormat(bytes)?.id,'AVIF');
  const info=await inspectFile(new File([bytes],'test.avif',{type:'image/avif'}));
  assert.deepEqual([info.width,info.height],[2,3]);
  await assert.rejects(inspectFile(new File([bytes.subarray(0,-1)],'test.avif')), /AVIF|corrupt/i);
  const sequence=Buffer.from(bytes); sequence.write('avis',16);
  await assert.rejects(inspectFile(new File([sequence],'test.avif')), /Animated|sequence/i);
});

test('registry separates SVG input-only from implemented image outputs', () => {
  for (const input of ['PNG','JPEG','WEBP','BMP','ICO','AVIF','SVG']) {
    for (const output of ['PNG','JPEG','WEBP','BMP','ICO','AVIF']) assert.equal(planConversion(input,output).steps.length,1);
    assert.throws(() => planConversion(input,'SVG'), /not supported/);
  }
});
