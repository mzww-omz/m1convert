import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOutput} from '../src/lib/stream-output.ts';
const job=()=>({signal:new AbortController().signal,stage:()=>{}});
test('bounded Blob sink snapshots chunks, counts bytes and rejects before excess allocation',async()=>{
 const sink=await createOutput(job(),'application/octet-stream',4);
 const bytes=Uint8Array.of(1,2);await sink.write(bytes);bytes.fill(9);await sink.write(Uint8Array.of(3,4));
 const result=await sink.finish();assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer())],[1,2,3,4]);
 const overflow=await createOutput(job(),'text/plain',2);await assert.rejects(overflow.write(new Uint8Array(3)),/limit|budget/i);await overflow.abort();
});
test('aborted output rejects without accepting more data',async()=>{
 const controller=new AbortController(),sink=await createOutput({...job(),signal:controller.signal},'text/plain');
 controller.abort();await assert.rejects(sink.write(Uint8Array.of(1)),{name:'AbortError'});await sink.abort();
});
