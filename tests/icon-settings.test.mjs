import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition } from '../src/lib/machine.ts';
test('ICO frame selection is bounded and retained on cancel/again', () => {
  let s=transition(initialState,{type:'LOAD',file:new File(['ico'],'x.ico')});
  s=transition(s,{type:'ANALYZED',runId:s.runId,analysis:{ info:{format:'ICO',mime:'image/x-icon',frames:[{width:16,height:16},{width:256,height:256}],frame:1},outputs:['PNG'],preview:null }});
  assert.equal(s.frame,1);
  assert.equal(transition(s,{type:'FRAME',frame:9}),s);
  s=transition(s,{type:'FRAME',frame:0}); assert.equal(s.frame,0);
  s=transition(s,{type:'START'}); s=transition(s,{type:'CANCEL'}); assert.equal(s.frame,0);
});
