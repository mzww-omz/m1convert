import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerEngine } from '../src/lib/scheduler.ts';

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
