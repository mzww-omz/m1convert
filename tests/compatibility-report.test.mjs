import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,matrix} from './helpers/compatibility-report.mjs';

test('success rate excludes unsupported and untested, never treats them as passing',()=>{
 const result=summarize([{status:'passed',ms:12},{status:'failed',ms:8},{status:'unsupported'},{status:'untested'}]);
 assert.deepEqual(result,{total:4,passed:1,failed:1,unsupported:1,untested:1,attempted:2,successRate:.5,coverage:.5,conversionMs:20});
});
test('matrix marks missing capability evidence as untested, not unsupported',()=>{
 const text=matrix([
  {browser:'chromium',routes:[],analyses:[{analysis:{browserCapabilities:{opfs:true,webLocks:false,environment:{offscreenCanvas:true},compression:['gzip'],decompression:['gzip']}}}]},
  {browser:'firefox',routes:[],analyses:[]}
 ]);
 assert.ok(text.includes('| OPFS API | present | untested |'));
 assert.ok(text.includes('| Web Locks API | absent | untested |'));
 assert.ok(text.includes('64 MiB'));
});

test('missing browser has no success rate rather than zero or full success',()=>{
 assert.equal(summarize([{status:'untested'}]).successRate,null);
 assert.equal(summarize([]).coverage,0);
 assert.throws(()=>summarize([{status:'unknown'}]),/status/);
});
