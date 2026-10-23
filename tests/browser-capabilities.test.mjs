import test from 'node:test';
import assert from 'node:assert/strict';
import * as registry from '../src/lib/codec-registry.ts';

// A constructor's presence must not advertise unsupported compression algorithms.
test('browser capability snapshot distinguishes API presence from accepted algorithms',()=>{
 assert.equal(typeof registry.detectBrowserCapabilities,'function');
 const scope={CompressionStream:class {constructor(format){if(format!=='gzip')throw new Error('unsupported');}},navigator:{storage:{getDirectory(){}}}};
 const result=registry.detectBrowserCapabilities(scope);
 assert.equal(result.environment.compression,true);
 assert.deepEqual(result.compression,['gzip']);
 assert.deepEqual(result.decompression,[]);
 assert.equal(result.opfs,true);
 assert.equal(result.webLocks,false);
 assert.equal(result.secureContext,false);
 assert.equal(result.environment.audioEncoder,false);
 assert.doesNotThrow(()=>JSON.stringify(result));
});
test('capability snapshot works without optional browser APIs (including SSR)',()=>{
 assert.equal(typeof registry.detectBrowserCapabilities,'function');
 const result=registry.detectBrowserCapabilities({});
 assert.equal(result.opfs,false);
 assert.equal(result.worker,false);
 assert.deepEqual(result.compression,[]);
});
