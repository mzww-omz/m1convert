import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, formatsFor, formatBytes, outputName } from '../src/lib/machine.ts';

const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
const load = () => transition(initialState, { type: 'LOAD', file });

test('only valid transitions can start a run; completion requires its current run id', () => {
  assert.equal(transition(initialState, { type: 'START' }), initialState);
  const details = load();
  assert.equal(details.phase, 'details');
  const running = transition(details, { type: 'START' });
  assert.equal(running.phase, 'progress');
  assert.equal(transition(running, { type: 'DONE', runId: running.runId - 1 }), running);
  assert.equal(transition(running, { type: 'DONE', runId: running.runId }).phase, 'complete');
});

test('cancel preserves input and settings and ignores a late callback', () => {
  let state = transition(load(), { type: 'FORMAT', format: 'PDF' });
  state = transition(state, { type: 'START' });
  const runId = state.runId;
  state = transition(state, { type: 'CANCEL' });
  assert.equal(state.phase, 'details');
  assert.equal(state.file, file);
  assert.equal(state.format, 'PDF');
  assert.equal(transition(state, { type: 'DONE', runId }), state);
});

test('retry and convert again keep settings; a new file resets settings', () => {
  let state = transition(load(), { type: 'START' });
  state = transition(state, { type: 'FAIL', runId: state.runId, message: 'Demo interrupted.' });
  assert.equal(state.phase, 'error');
  state = transition(state, { type: 'RETRY' });
  assert.equal(state.phase, 'progress');
  state = transition(state, { type: 'DONE', runId: state.runId });
  state = transition(state, { type: 'AGAIN' });
  assert.equal(state.phase, 'details');
  assert.equal(state.file, file);
  state = transition(state, { type: 'LOAD', file: new File(['x'], 'photo.png', { type: 'image/png' }) });
  assert.equal(state.format, 'WEBP');
  assert.equal(transition(state, { type: 'RESET' }).file, null);
});

test('progress is monotonic, bounded, and scoped to the active run', () => {
  let state = transition(load(), { type: 'START' });
  state = transition(state, { type: 'TICK', runId: state.runId, progress: 50 });
  assert.equal(transition(state, { type: 'TICK', runId: state.runId, progress: 20 }).progress, 50);
  assert.equal(transition(state, { type: 'TICK', runId: state.runId, progress: 200 }).progress, 99);
  assert.equal(transition(state, { type: 'TICK', runId: state.runId, progress: NaN }), state);
});

test('invalid output settings are ignored and format-specific settings are retained', () => {
  let state = load();
  assert.equal(transition(state, { type: 'FORMAT', format: 'EXE' }), state);
  assert.equal(transition(state, { type: 'QUALITY', quality: Infinity }), state);
  state = transition(state, { type: 'QUALITY', quality: 85 });
  assert.equal(transition(state, { type: 'START' }).quality, 85);
  assert.deepEqual(formatsFor(new File([], 'unknown.bin')), ['ZIP']);
});

test('names and sizes remain useful for empty, large, and extensionless files', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(5 * 1024 ** 3), '5 GB');
  assert.equal(outputName('archive.tar.gz', 'ZIP'), 'archive.tar.zip');
  assert.equal(outputName('README', 'PDF'), 'README.pdf');
});
