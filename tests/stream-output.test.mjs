import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOutput,prepareTemporary,releaseTemporary} from '../src/lib/stream-output.ts';
const job=()=>({signal:new AbortController().signal,stage:()=>{}});
test('bounded Blob sink snapshots chunks, counts bytes and rejects before excess allocation',async()=>{
 const sink=await createOutput(job(),'application/octet-stream',4);
 const bytes=Uint8Array.of(1,2);await sink.write(bytes);bytes.fill(9);await sink.write(Uint8Array.of(3,4));
 const result=await sink.finish();assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer())],[1,2,3,4]);
 const overflow=await createOutput(job(),'text/plain',2);await assert.rejects(overflow.write(new Uint8Array(3)),/limit|budget/i);await overflow.abort();
});
test('opening disk output reclaims only stale Convert-owned files, not foreign or recent files',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(navigator,'storage'),files=new Map([
  ['convert-a',new File([],'a',{lastModified:Date.now()-2*86400_000})],
  ['convert-b',new File([],'b')],['convert-d',new File([],'d',{lastModified:0})],['user-document',new File([],'doc',{lastModified:0})]
 ]);
 const directory={async *[Symbol.asyncIterator](){for(const name of files.keys())yield [name,{kind:'file'}];},getFileHandle:async(name,options)=>{if(options?.create)files.set(name,new File([],name));return {getFile:async()=>files.get(name)};},removeEntry:async name=>files.delete(name)};
 Object.defineProperty(navigator,'storage',{configurable:true,value:{getDirectory:async()=>({getDirectoryHandle:async()=>directory})}});
 let unlock,held;
 if(navigator.locks)await new Promise(resolve=>{held=navigator.locks.request('convert-temporary/convert-d',async()=>{const pending=new Promise(release=>unlock=release);resolve();await pending;});});
 try {await prepareTemporary('convert-c');assert.deepEqual([...files.keys()].sort(),navigator.locks?['convert-b','convert-c','convert-d','user-document']:['convert-a','convert-b','convert-c','convert-d','user-document']);}
 finally {await releaseTemporary('convert-c');unlock?.();await held;if(descriptor)Object.defineProperty(navigator,'storage',descriptor);else delete navigator.storage;}
});

test('inaccessible WebKit private OPFS uses bounded Blob without hiding quota or allocation failures',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(navigator,'storage');
 let failure=new DOMException('Private session storage unavailable','UnknownError');
 Object.defineProperty(navigator,'storage',{configurable:true,value:{getDirectory:async()=>{throw failure;}}});
 try {
  const sink=await createOutput({...job(),temporary:async()=>{assert.fail('inaccessible storage must not create a host file');}},'text/plain',2);
  assert.equal(sink.metrics.mode,'blob');await sink.write(Uint8Array.of(1,2));
  await assert.rejects(sink.write(Uint8Array.of(3)),/Blob memory budget/);
  assert.deepEqual([...new Uint8Array(await(await sink.finish()).blob.arrayBuffer())],[1,2]);
  for(const error of [new DOMException('Full','QuotaExceededError'),new RangeError('Allocation failed')]) {
   failure=error;await assert.rejects(createOutput({...job(),temporary:async()=>{}},'text/plain'),/Temporary disk output could not open/);
  }
 }finally{if(descriptor)Object.defineProperty(navigator,'storage',descriptor);else delete navigator.storage;}
});

test('aborted output rejects without accepting more data',async()=>{
 const controller=new AbortController(),sink=await createOutput({...job(),signal:controller.signal},'text/plain');
 controller.abort();await assert.rejects(sink.write(Uint8Array.of(1)),{name:'AbortError'});await sink.abort();
});
