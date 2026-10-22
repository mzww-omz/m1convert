import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerEngine } from '../src/lib/scheduler.ts';
import { rasterizeSvg } from '../src/lib/adapters/svg-raster.ts';

test('SVG abort promptly releases Blob URL even when native image decoding never settles', async () => {
  const original=globalThis.Image;
  let image;
  globalThis.Image=class { constructor() { image=this; } decode() { return new Promise(()=>{}); } };
  const controller=new AbortController();
  try {
    const pending=rasterizeSvg('<svg/>',controller.signal);
    const url=image.src;
    assert.ok((await fetch(url)).ok);
    controller.abort();
    await Promise.race([assert.rejects(pending,/Cancelled/),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Abort did not settle SVG decode')),100))]);
    await assert.rejects(fetch(url)); assert.equal(image.src,'');
  } finally { globalThis.Image=original; }
});

test('cancelling pending SVG rasterization terminates worker and aborts raster resources', async () => {
  let worker, aborted=false;
  const engine=createWorkerEngine(() => worker={ postMessage() {}, terminate() { this.ended=true; } },1000,
    (_svg,signal) => new Promise((_,reject) => signal.addEventListener('abort',() => { aborted=true; reject(new DOMException('Cancelled','AbortError')); })));
  const controller=new AbortController();
  const job=engine.inspect(new File(['svg'],'x.svg'),controller.signal);
  worker.onmessage({data:{type:'rasterize',svg:'<svg/>'}});
  await new Promise(resolve => setTimeout(resolve,0));
  controller.abort();
  await assert.rejects(job,/Cancelled/);
  assert.equal(aborted,true); assert.equal(worker.ended,true);
});
