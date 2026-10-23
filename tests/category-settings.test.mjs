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
test('audio bitrate and quality mode update independently, validate bounds and survive cancel',()=>{
 let state=ready();state=transition(state,{type:'AUDIO',bitrate:128});state=transition(state,{type:'AUDIO',mode:'quality'});
 assert.deepEqual(state.audio,{sampleRate:0,channels:0,bitrate:128,mode:'quality'});
 for(const event of [{type:'AUDIO',bitrate:NaN},{type:'AUDIO',bitrate:2147484},{type:'AUDIO',mode:'fake'}])assert.equal(transition(state,event),state);
 state=transition(state,{type:'AUDIO',channels:1});assert.equal(state.audio.bitrate,128);assert.equal(state.audio.mode,'quality');
 const cancelled=transition(transition(state,{type:'START'}),{type:'CANCEL'});assert.deepEqual(cancelled.audio,state.audio);
});

test('changing audio format keeps visible settings compatible instead of showing a blank select',()=>{
 let state=ready();state={...state,analysis:{...state.analysis,outputs:['WAV','MP3','OPUS']}};
 state=transition(state,{type:'AUDIO',sampleRate:96000,bitrate:320});state=transition(state,{type:'FORMAT',format:'MP3'});
 assert.equal(state.audio.sampleRate,0);assert.equal(state.audio.bitrate,320);
 state=transition(state,{type:'AUDIO',sampleRate:16000});assert.equal(state.audio.bitrate,128);
 state=transition(state,{type:'FORMAT',format:'OPUS'});assert.equal(state.audio.sampleRate,48000);
});

test('audio batches retain their files across cancel but new load/reset clears them',()=>{
  const file=new File(['test'],'first.wav'),files=[file,new File(['test'],'second.aiff')];
  const state=transition(initialState,{type:'LOAD',file,files});
  assert.equal(state.files.length,2);
  assert.equal(transition(state,{type:'RESET'}).files,undefined);
  assert.equal(transition(state,{type:'LOAD',file}).files,undefined);
});
