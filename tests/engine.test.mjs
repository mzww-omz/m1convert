import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageEngine } from '../src/lib/engine.ts';

const request = () => ({ file: new File(['x'], 'test.png'), format: 'PNG', quality: 90 });

test('the production engine never substitutes a demo or main-thread conversion when workers are unavailable', async () => {
  await assert.rejects(imageEngine.run(request(), new AbortController().signal, () => assert.fail()), /conversion workers/);
  await assert.rejects(imageEngine.inspect(request().file, new AbortController().signal), /conversion workers/);
});

test('an already aborted production job cannot allocate workers or report progress', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(imageEngine.run(request(), controller.signal, () => assert.fail()), { name: 'AbortError' });
  await assert.rejects(imageEngine.inspect(request().file, controller.signal), { name: 'AbortError' });
});
