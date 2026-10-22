import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, formatBytes, outputName } from '../src/lib/machine.ts';

const file = new File(['image'], 'photo.png', { type: 'image/png' });
const analysis = { info: { format: 'PNG', mime: 'image/png', encodedWidth: 128, encodedHeight: 80, width: 128, height: 80, orientation: 1 }, outputs: ['PNG', 'JPEG', 'WEBP'], preview: new Blob(['thumbnail'], { type: 'image/png' }) };
const load = () => transition(initialState, { type: 'LOAD', file });
const ready = () => { const state = load(); return transition(state, { type: 'ANALYZED', runId: state.runId, analysis }); };
const result = format => ({ blob: new Blob(['encoded'], { type: `image/${format === 'JPEG' ? 'jpeg' : format.toLowerCase()}` }), name: `photo.${format.toLowerCase()}`, format, mime: `image/${format.toLowerCase()}`, width: 128, height: 80 });

test('only ready inputs can start; completion requires the active run and real result', () => {
  assert.equal(transition(initialState, { type: 'START' }), initialState);
  const loading = load();
  assert.equal(loading.phase, 'details');
  assert.equal(transition(loading, { type: 'START' }), loading);
  const running = transition(ready(), { type: 'START' });
  assert.equal(running.phase, 'progress');
  assert.equal(transition(running, { type: 'DONE', runId: running.runId - 1, result: result('WEBP') }), running);
  const complete = transition(running, { type: 'DONE', runId: running.runId, result: result('WEBP') });
  assert.equal(complete.phase, 'complete');
  assert.equal(complete.result.blob.size, 7);
});

test('cancel preserves input/settings and ignores late progress and completion', () => {
  let state = transition(ready(), { type: 'FORMAT', format: 'JPEG' });
  state = transition(state, { type: 'START' });
  const runId = state.runId;
  state = transition(state, { type: 'CANCEL' });
  assert.equal(state.phase, 'details');
  assert.equal(state.file, file);
  assert.equal(state.format, 'JPEG');
  assert.deepEqual(state.analysis, analysis);
  assert.equal(transition(state, { type: 'DONE', runId, result: result('JPEG') }), state);
  assert.equal(transition(state, { type: 'TICK', runId, progress: 90, stage: 'encoding' }), state);
});

test('retry and convert again keep settings but release results; new file resets them', () => {
  let state = transition(ready(), { type: 'START' });
  state = transition(state, { type: 'FAIL', runId: state.runId, message: 'Encoder unavailable.' });
  assert.equal(state.phase, 'error');
  state = transition(state, { type: 'RETRY' });
  assert.equal(state.phase, 'progress');
  state = transition(state, { type: 'DONE', runId: state.runId, result: result('WEBP') });
  state = transition(state, { type: 'AGAIN' });
  assert.equal(state.phase, 'details');
  assert.equal(state.file, file);
  assert.equal(state.result, null);
  state = transition(state, { type: 'LOAD', file: new File(['x'], 'new.png') });
  assert.equal(state.analysis, null);
  assert.equal(state.format, '');
  assert.equal(transition(state, { type: 'RESET' }).file, null);
});

test('measurable progress is monotonic/bounded, unknown work stays indeterminate', () => {
  let state = transition(ready(), { type: 'START' });
  assert.equal(state.progress, null);
  state = transition(state, { type: 'TICK', runId: state.runId, stage: 'decoding', progress: null });
  assert.equal(state.stage, 'decoding');
  assert.equal(state.progress, null);
  state = transition(state, { type: 'TICK', runId: state.runId, stage: 'encoding', progress: 50 });
  assert.equal(transition(state, { type: 'TICK', runId: state.runId, stage: 'encoding', progress: 20 }).progress, 50);
  assert.equal(transition(state, { type: 'TICK', runId: state.runId, stage: 'encoding', progress: 200 }).progress, 99);
  assert.equal(transition(state, { type: 'TICK', runId: state.runId, stage: 'encoding', progress: NaN }), state);
});

test('settings are restricted to detected routes and real browser encoders', () => {
  let state = ready();
  assert.equal(transition(state, { type: 'FORMAT', format: 'AVIF' }), state);
  assert.equal(transition(state, { type: 'QUALITY', quality: Infinity }), state);
  state = transition(state, { type: 'QUALITY', quality: 85 });
  assert.equal(transition(state, { type: 'START' }).quality, 85);
  const loading = load();
  state = transition(loading, { type: 'ANALYZED', runId: loading.runId, analysis: { ...analysis, outputs: ['PNG'] } });
  assert.equal(state.format, 'PNG');
  assert.equal(transition(state, { type: 'FORMAT', format: 'WEBP' }), state);
});

test('analysis responses cannot overwrite a replacement, reset, or retry', () => {
  const first = load();
  const second = transition(first, { type: 'LOAD', file: new File(['new'], 'other.png') });
  assert.equal(transition(second, { type: 'ANALYZED', runId: first.runId, analysis }), second);
  let state = transition(second, { type: 'ANALYSIS_FAILED', runId: second.runId, message: 'Invalid file.' });
  assert.equal(state.analysisError, 'Invalid file.');
  assert.equal(transition(state, { type: 'START' }), state);
  state = transition(state, { type: 'ANALYZE' });
  assert.equal(state.analysisError, '');
  assert.equal(transition(state, { type: 'ANALYZED', runId: second.runId, analysis }), state);
  const reset = transition(state, { type: 'RESET' });
  assert.equal(transition(reset, { type: 'ANALYZED', runId: state.runId, analysis }), reset);
});

test('names and sizes remain useful for empty, large, and extensionless files', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(5 * 1024 ** 3), '5 GB');
  assert.equal(outputName('archive.tar.png', 'WEBP'), 'archive.tar.webp');
  assert.equal(outputName('README', 'JPEG'), 'README.jpg');
});
