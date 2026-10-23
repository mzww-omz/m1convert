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

test('disk outputs are removed on clear and on URL allocation failure',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(navigator,'storage'),files=new Set(['convert-a','convert-b']);
 Object.defineProperty(navigator,'storage',{configurable:true,value:{getDirectory:async()=>({getDirectoryHandle:async()=>({removeEntry:async name=>files.delete(name)})})}});
 const create=URL.createObjectURL;
 try {
  const manager=new ResultManager();manager.set({blob:new Blob(['disk']),name:'a.zip',temporaryFile:'convert-a'});manager.clear();
  await new Promise(resolve=>setImmediate(resolve));assert.ok(!files.has('convert-a'));
  URL.createObjectURL=()=>{throw new RangeError('simulated URL allocation failure');};
  assert.throws(()=>manager.set({blob:new Blob(['disk']),name:'b.zip',temporaryFile:'convert-b'}),RangeError);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(files.size,0);
 } finally {URL.createObjectURL=create;if(descriptor)Object.defineProperty(navigator,'storage',descriptor);else delete navigator.storage;}
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
