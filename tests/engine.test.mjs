import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoEngine } from '../src/lib/engine.ts';

const request = () => ({ file: new File(['x'], 'test.txt'), format: 'PDF', quality: 90 });

test('demo reports progress but never returns a downloadable converted file', async () => {
  const progress = [];
  const result = await demoEngine.run(request(), new AbortController().signal, n => progress.push(n));
  assert.deepEqual(result, { kind: 'demo' });
  assert.ok(progress.length > 1);
  assert.ok(progress.every((n, i) => n >= 0 && n <= 99 && (!i || n >= progress[i - 1])));
});

test('aborting prevents completion and all subsequent progress', async () => {
  const controller = new AbortController();
  const progress = [];
  const result = demoEngine.run(request(), controller.signal, n => { progress.push(n); controller.abort(); });
  await assert.rejects(result, { name: 'AbortError' });
  const count = progress.length;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(progress.length, count);
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(demoEngine.run(request(), alreadyAborted.signal, () => assert.fail()), { name: 'AbortError' });
});
