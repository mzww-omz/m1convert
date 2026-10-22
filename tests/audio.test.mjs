import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pcmCodec, decodePcm, encodeWav, convertPcm } from '../src/lib/adapters/pcm.ts';
const noop=()=>{};
const pcm={sampleRate:48000,channels:2,samples:Float32Array.from({length:960},(_,i)=>i%2?-.5:.5)};
test('WAV samples, channels and duration round trip with metadata-free PCM16 output', () => {
  const bytes=encodeWav(pcm), decoded=decodePcm(bytes,'WAV');
  assert.equal(decoded.sampleRate,48000); assert.equal(decoded.channels,2); assert.equal(decoded.samples.length,960);
  assert.ok(Math.abs(decoded.samples[0]-.5)<.0001); assert.equal(decoded.samples[1],-.5);
  assert.equal(bytes.length,44+960*2);
  const mono=convertPcm(decoded,{sampleRate:24000,channels:1});
  assert.equal(mono.samples.length,240); assert.ok(mono.samples.every(v=>Math.abs(v)<.0001));
  const stereo=convertPcm({sampleRate:48000,channels:1,samples:new Float32Array(480).fill(.25)},{sampleRate:16000,channels:2});
  assert.equal(stereo.samples.length,320); assert.ok(stereo.samples.every(v=>Math.abs(v-.25)<.0001));
});
test('PCM rejects invalid chunks, sample formats, NaN, rates, channels and budgets', () => {
  const base=encodeWav(pcm);
  for(const mutate of [
    (b,v)=>v.setUint32(4,1,true),(b,v)=>v.setUint32(16,0xffffffff,true),
    (b,v)=>v.setUint16(22,8,true),(b,v)=>v.setUint32(24,0,true),
    (b,v)=>v.setUint16(20,6,true),(b,v)=>v.setUint16(32,99,true),
    (b,v)=>v.setUint32(40,3,true)
  ]) { const bad=base.slice(); mutate(bad,new DataView(bad.buffer)); assert.throws(()=>decodePcm(bad,'WAV')); }
  assert.throws(()=>encodeWav({...pcm,samples:Float32Array.of(NaN,0)}),/sample/i);
  assert.throws(()=>convertPcm(pcm,{sampleRate:1,channels:1}),/rate/i);
  assert.throws(()=>convertPcm(pcm,{sampleRate:48000,channels:3}),/channel/i);
  assert.throws(()=>convertPcm(pcm,{sampleRate:48000,channels:NaN}),/channel/i);
  assert.throws(()=>decodePcm(base.subarray(0,-1),'WAV'));
});
test('independent WAV and AIFF fixtures convert to WAV with rate/channel options', async () => {
  for(const [name,mime] of [['tone.wav','audio/wav'],['tone.aiff','audio/aiff']]) {
    const file=new File([await readFile(new URL('./fixtures/'+name,import.meta.url))],name,{type:mime});
    const info=await pcmCodec.inspect(file,noop);
    assert.deepEqual(info.outputs,['WAV']); assert.equal(info.info.channels,2); assert.equal(info.info.sampleRate,48000);
    for(const audio of [{sampleRate:0,channels:0},{sampleRate:16000,channels:1},{sampleRate:44100,channels:2}]) {
      const result=await pcmCodec.run({file,format:'WAV',quality:90,audio},noop);
      const decoded=decodePcm(new Uint8Array(await result.blob.arrayBuffer()),'WAV');
      assert.equal(decoded.sampleRate,audio.sampleRate||48000); assert.equal(decoded.channels,audio.channels||2);
      assert.ok(Math.abs(decoded.samples.length/decoded.channels/decoded.sampleRate-info.info.duration)<1/decoded.sampleRate);
    }
    await assert.rejects(pcmCodec.inspect(new File([file],'fake.mp3'),noop),/extension/i);
    await assert.rejects(pcmCodec.run({file,format:'MP3',quality:90},noop),/supported/i);
  }
});
test('audio batches validate every file and package actual WAV results without duplicate names', async () => {
  const files=await Promise.all(['tone.wav','tone.aiff'].map(async name=>new File([await readFile(new URL('./fixtures/'+name,import.meta.url))],name)));
  const result=await pcmCodec.run({file:files[0],files,format:'WAV',quality:90,audio:{sampleRate:16000,channels:1}},noop);
  assert.equal(result.format,'ZIP');
  const {decodeZip}=await import('../src/lib/adapters/archive.ts');
  const entries=await decodeZip(new Uint8Array(await result.blob.arrayBuffer())); assert.equal(entries.length,2);
  for(const entry of entries) { const pcm=decodePcm(entry.data,'WAV'); assert.equal(pcm.sampleRate,16000);assert.equal(pcm.channels,1); }
  await assert.rejects(pcmCodec.run({file:files[0],files:[files[0],new File(['bad'],'bad.wav')],format:'WAV',quality:90},noop),/audio|supported/i);
});
test('resampling attenuates frequencies above the new Nyquist limit', () => {
  const samples=Float32Array.from({length:4800},(_,i)=>Math.sin(2*Math.PI*16000*i/48000));
  const converted=convertPcm({sampleRate:48000,channels:1,samples},{sampleRate:16000,channels:1});
  const inner=converted.samples.subarray(30,-30);
  assert.ok(Math.sqrt(inner.reduce((s,v)=>s+v*v,0)/inner.length)<.03);
});
