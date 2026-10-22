import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkerEngine } from '../src/lib/scheduler.ts';
import { verifyOutput } from '../src/lib/image-format.ts';

class WorkerPort {
  onmessage = null; onerror = null; onmessageerror = null; terminated = false;
  constructor(handle) { this.handle = handle; }
  postMessage(request) { this.handle(request, this); }
  emit(data) { this.onmessage?.({ data }); }
  terminate() { this.terminated = true; }
}
const request = { file: new File(['input'], 'input.png'), format: 'JPEG', quality: 85 };

test('scheduler resolves the actual worker result and cleans up the worker', async () => {
  const blob = new Blob([await readFile(new URL('./fixtures/swatch.jpg', import.meta.url))], { type: 'image/jpeg' });
  const expected = { blob, name: 'input.jpg', format: 'JPEG', mime: 'image/jpeg', width: 128, height: 80 };
  let worker;
  const engine = createWorkerEngine(() => worker = new WorkerPort((_, port) => queueMicrotask(() => {
    port.emit({ type: 'stage', stage: 'encoding' });
    port.emit({ type: 'converted', result: expected });
  })));
  const stages = [];
  assert.deepEqual(await engine.run(request, new AbortController().signal, stage => stages.push(stage)), expected);
  assert.deepEqual(stages, [{ stage: 'encoding', percent: null }]);
  assert.equal(worker.terminated, true);
});

test('measured audio frame progress crosses the worker boundary; invalid percentages stay indeterminate',async()=>{
 const engine=createWorkerEngine(()=>new WorkerPort((_,port)=>queueMicrotask(()=>{
  for(const percent of [25,95,Infinity,NaN,200])port.emit({type:'stage',stage:'encoding',percent});
  port.emit({type:'converted',result:{}});
 })));
 const stages=[];await engine.run(request,new AbortController().signal,p=>stages.push(p));
 assert.deepEqual(stages.map(p=>p.percent),[25,95,null,null,99]);
});

test('abort terminates real work, rejects promptly, and ignores late replies', async () => {
  let worker;
  const controller = new AbortController();
  const stages = [];
  const engine = createWorkerEngine(() => worker = new WorkerPort(() => {}));
  const pending = engine.run(request, controller.signal, stage => stages.push(stage));
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  worker.emit({ type: 'stage', stage: 'encoding' });
  worker.emit({ type: 'converted', result: {} });
  assert.equal(worker.terminated, true);
  assert.deepEqual(stages, []);
  await assert.rejects(engine.run(request, controller.signal, () => assert.fail()), { name: 'AbortError' });
});

test('worker failure, message decode errors, timeout and unsupported environments are recoverable', async () => {
  for (const event of ['error', 'messageerror', 'timeout']) {
    let worker;
    const engine = createWorkerEngine(() => worker = new WorkerPort(() => {}), 20);
    const pending = engine.run(request, new AbortController().signal, () => {});
    if (event === 'error') worker.onerror({ preventDefault() {} });
    if (event === 'messageerror') worker.onmessageerror({});
    await assert.rejects(pending, /worker|timed out/i);
    assert.equal(worker.terminated, true);
  }
  await assert.rejects(createWorkerEngine(() => { throw new Error('Workers unavailable'); }).run(request, new AbortController().signal, () => {}), /Workers unavailable/);
});

test('output MIME and magic bytes must both agree; PNG fallback cannot masquerade as WebP', async () => {
  const png = await readFile(new URL('./fixtures/swatch.png', import.meta.url));
  await verifyOutput(new Blob([png], { type: 'image/png' }), 'PNG');
  await assert.rejects(verifyOutput(new Blob([png], { type: 'image/webp' }), 'WEBP'), /encode/);
  await assert.rejects(verifyOutput(new Blob([png], { type: 'image/jpeg' }), 'PNG'), /encode/);
  await assert.rejects(verifyOutput(new Blob([], { type: 'image/png' }), 'PNG'), /encode/);
});
