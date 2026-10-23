import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectEnvironment,engineCapabilities,runCodec,EngineFallbackError} from '../src/lib/codec-registry.ts';
const env={wasm:true,wasmSimd:false,sharedMemory:false,offscreenCanvas:false,imageBitmap:false,canvasEncoding:false,audioEncoder:false,audioDecoder:false,compression:false,decompression:false};
const context=signal=>({signal:signal??new AbortController().signal,stage:()=>{}});
function engine(id,run,extra={}) {
 return {capability:{id,kind:'wasm',operation:'encode',formats:['PNG'],quality:'lossless',requirements:['wasm'],limits:['bounded input'],containers:['PNG']},load:async()=>({run}),...extra};
}
test('environment detection uses features, not user agent or an assumed thread requirement',()=>{
 const none=detectEnvironment({});assert.equal(none.wasm,false);assert.equal(none.sharedMemory,false);assert.equal(none.audioEncoder,false);
 const actual=detectEnvironment();assert.equal(actual.wasm,true);
 const noIsolation=detectEnvironment({WebAssembly,SharedArrayBuffer,crossOriginIsolated:false});assert.equal(noIsolation.wasm,true);assert.equal(noIsolation.sharedMemory,false);
});
test('capabilities filter formats, features and exact options without loading implementations',async()=>{
 let loaded=0;const item=engine('bounded',()=>assert.fail(),{supports:q=>q.width>100?'Width exceeds this engine budget.':undefined,load:async()=>{loaded++;assert.fail();}});
 const report=await engineCapabilities([item],{format:'PNG',width:101},env);
 assert.equal(report[0].available,false);assert.match(report[0].reason,/budget/);assert.equal(report[0].id,'bounded');
 assert.equal((await engineCapabilities([item],{format:'JPEG'},env))[0].available,false);
 assert.equal((await engineCapabilities([item],{format:'PNG',width:1},{...env,wasm:false}))[0].available,false);
 assert.equal(loaded,0);
});
test('ordered lazy fallback disposes an unsuccessful engine before using and verifying the next',async()=>{
 const events=[];
 const a=engine('native',()=>{events.push('first');throw new EngineFallbackError('unsupported','Exact config unsupported.');},{load:async()=>({run:async()=>{events.push('first');throw new EngineFallbackError('unsupported','Exact config unsupported.');},dispose:()=>events.push('disposed')})});
 const b=engine('wasm',async()=>{events.push('second');return 42;});
 const c=engine('unused',()=>assert.fail(),{load:async()=>assert.fail('Unused engine must stay lazy')});
 const result=await runCodec([a,b,c],0,{format:'PNG'},context(),value=>{events.push('verify');assert.equal(value,42);},env);
 assert.deepEqual(events,['first','disposed','second','verify']);assert.equal(result.engineId,'wasm');assert.deepEqual(result.fallbackFrom,['native']);
});
test('verification participates in safe fallback but ordinary validation/resource errors never do',async()=>{
 let fallback=0;const next=engine('next',async()=>{fallback++;return 2;});
 const a=engine('first',async()=>1);
 assert.equal((await runCodec([a,next],0,{format:'PNG'},context(),value=>{if(value===1)throw new EngineFallbackError('unsupported','Wrong output format.');},env)).value,2);
 for(const error of [new Error('Safety limit: memory budget.'),new Error('Corrupt input.'),new DOMException('Cancelled','AbortError')]) {
  const terminal=engine('terminal',()=>{throw error;});
  await assert.rejects(runCodec([terminal,next],0,{format:'PNG'},context(),()=>{},env),e=>e===error);
 }
 assert.equal(fallback,1);
});
test('abort before load and after a pending load never starts a run or fallback; late sessions dispose',async()=>{
 const c=new AbortController();c.abort();let loads=0;
 const e=engine('slow',()=>assert.fail(),{load:async()=>{loads++;return {run:()=>assert.fail()};}});
 await assert.rejects(runCodec([e],0,{format:'PNG'},context(c.signal),()=>{},env),{name:'AbortError'});assert.equal(loads,0);
 const d=new AbortController();let resolve,disposed=0;const ready=new Promise(r=>resolve=r);
 const slow=engine('slow',()=>assert.fail(),{load:()=>ready});
 const pending=runCodec([slow,engine('next',()=>assert.fail())],0,{format:'PNG'},context(d.signal),()=>{},env);
 await new Promise(r=>setImmediate(r));d.abort();resolve({run:()=>assert.fail(),dispose:()=>disposed++});
 await assert.rejects(pending,{name:'AbortError'});assert.equal(disposed,1);
});
test('an unavailable loader falls back, an exhausted registry explains attempted engines, cleanup errors stop retry',async()=>{
 const unavailable=engine('missing',()=>assert.fail(),{load:async()=>{throw new EngineFallbackError('unavailable','Local WASM asset missing.');}});
 await assert.rejects(runCodec([unavailable],0,{format:'PNG'},context(),()=>{},env),/missing.*Local WASM asset missing/i);
 const brokenCleanup=engine('cleanup',()=>{}, {load:async()=>({run:async()=>{throw new EngineFallbackError('unsupported','retry');},dispose:()=>{throw new Error('Cleanup failed');}})});
 await assert.rejects(runCodec([brokenCleanup,engine('next',()=>assert.fail())],0,{format:'PNG'},context(),()=>{},env),/Cleanup failed/);
});
