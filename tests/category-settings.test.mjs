import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,transition} from '../src/lib/machine.ts';
function ready(category='audio') {
  const file=new File(['test'],'test.wav');
  const state=transition(initialState,{type:'LOAD',file});
  return transition(state,{type:'ANALYZED',runId:state.runId,analysis:{info:{format:category==='audio'?'WAV':'TAR',mime:'application/octet-stream',category},outputs:category==='audio'?['WAV']:['ZIP','TAR'],preview:null}});
}
test('category settings are validated, retained on cancel and reset on replacement',()=>{
  let state=ready();
  state=transition(state,{type:'AUDIO',sampleRate:16000,channels:1});
  assert.deepEqual(state.audio,{sampleRate:16000,channels:1});
  state=transition(state,{type:'AUDIO',sampleRate:44100});
  state=transition(state,{type:'AUDIO',channels:2});
  assert.deepEqual(state.audio,{sampleRate:44100,channels:2});
  assert.equal(transition(state,{type:'AUDIO',sampleRate:123,channels:1}),state);
  assert.equal(transition(state,{type:'AUDIO',sampleRate:48000,channels:3}),state);
  const progress=transition(state,{type:'START'});
  assert.equal(transition(progress,{type:'AUDIO',sampleRate:48000,channels:2}),progress);
  assert.deepEqual(transition(progress,{type:'CANCEL'}).audio,state.audio);
  assert.deepEqual(transition(state,{type:'RESET'}).audio,{sampleRate:0,channels:0});
  let archive=ready('archive'); archive=transition(archive,{type:'ARCHIVE',compression:'store'});
  assert.deepEqual(archive.archive,{compression:'store'});
  assert.equal(transition(archive,{type:'ARCHIVE',compression:'fake'}),archive);
  assert.equal(transition(state,{type:'ARCHIVE',compression:'store'}),state);
});
test('audio batches retain their files across cancel but new load/reset clears them',()=>{
  const file=new File(['test'],'first.wav'),files=[file,new File(['test'],'second.aiff')];
  const state=transition(initialState,{type:'LOAD',file,files});
  assert.equal(state.files.length,2);
  assert.equal(transition(state,{type:'RESET'}).files,undefined);
  assert.equal(transition(state,{type:'LOAD',file}).files,undefined);
});
