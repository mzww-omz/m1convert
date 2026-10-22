import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { compileModule } from 'svelte/compiler';

// Compile the real runes controller with the already-installed project toolchain.
const url = new URL('../src/lib/converter.svelte.ts', import.meta.url);
const js = ts.transpileModule(await readFile(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
let code = compileModule(js, { filename: url.pathname, generate: 'client' }).js.code;
code = code.replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) => `from ${quote}${specifier.startsWith('.') ? new URL(specifier + '.ts', url).href : import.meta.resolve(specifier)}${quote}`);
const { Converter } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const file = () => new File(['original'], 'input.png', { type: 'image/png' });
const analysis = { info: { format: 'PNG', mime: 'image/png', width: 128, height: 80, encodedWidth: 128, encodedHeight: 80, orientation: 1 }, outputs: ['PNG'], preview: new Blob(['thumb']) };
const result = { blob: new Blob(['converted'], { type: 'image/png' }), name: 'input.png', mime: 'image/png', format: 'PNG', width: 128, height: 80 };

test('controller ignores stale analysis and conversions even if an adapter ignores abort', async () => {
  const first = deferred(), second = deferred(), conversion = deferred();
  const signals = [];
  let count = 0;
  const c = new Converter({ inspect: (_file, signal) => { signals.push(signal); return ++count === 1 ? first.promise : second.promise; }, run: (_request, signal) => { signals.push(signal); return conversion.promise; } });
  c.send({ type: 'LOAD', file: file() });
  c.send({ type: 'LOAD', file: new File(['new'], 'second.png') });
  assert.equal(signals[0].aborted, true);
  first.resolve(analysis); await flush(); assert.equal(c.state.analysis, null);
  second.resolve(analysis); await flush(); assert.equal(c.state.file.name, 'second.png');
  c.send({ type: 'START' }); c.send({ type: 'CANCEL' });
  assert.equal(signals[2].aborted, true);
  conversion.resolve(result); await flush();
  assert.equal(c.state.phase, 'details'); assert.equal(c.state.result, null);
  c.destroy(); assert.equal(c.state.file, null);
});

test('URL allocation failure produces a recoverable error rather than leaving progress stuck', async () => {
  const c = new Converter({ inspect: async () => analysis, run: async () => result });
  c.send({ type: 'LOAD', file: file() }); await flush();
  const create = URL.createObjectURL;
  try {
    URL.createObjectURL = () => { throw new Error('Output URL allocation failed.'); };
    c.send({ type: 'START' }); await flush();
    assert.equal(c.state.phase, 'error');
    assert.match(c.state.error, /allocation failed/);
  } finally { URL.createObjectURL = create; }
  c.send({ type: 'RETRY' }); await flush();
  assert.equal(c.state.phase, 'complete');
  assert.equal(await c.state.result.blob.text(), 'converted');
  c.send({ type: 'AGAIN' }); assert.equal(c.state.result, null);
  c.destroy();
});
