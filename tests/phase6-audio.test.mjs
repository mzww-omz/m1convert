import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {audioCodec,availableAudioOutputs} from '../src/lib/adapters/audio-codec.ts';
import {decodePcm,encodeWav,quantizePcm16} from '../src/lib/adapters/pcm.ts';
import {planConversion} from '../src/lib/registry.ts';

// Catches missing AIFF routing, wrong endian samples, rate fields and PCM16 clipping.
test('all audio inputs have a real AIFF output; WAV to AIFF preserves PCM16 values',async()=>{
 for(const format of ['WAV','AIFF','MP3','FLAC','OGG','OPUS','AAC','M4A'])assert.ok(planConversion(format,'AIFF'));
 assert.ok((await availableAudioOutputs()).includes('AIFF'));
 for(const sampleRate of [4000,44100,48000,384000]) {
  const rate=sampleRate;
  const source={sampleRate:rate,channels:2,samples:Float32Array.of(-1,32767/32768,.5,-.25,0,1/32768)};
  const file=new File([encodeWav(source)],'source.wav');
  const result=await audioCodec.run({file,format:'AIFF',quality:90,audio:{sampleRate:0,channels:0,bitrate:0}},()=>{});
  const b=new Uint8Array(await result.blob.arrayBuffer()),v=new DataView(b.buffer);
  assert.equal(result.mime,'audio/aiff');assert.equal(result.name,'source.aiff');
  assert.equal(new TextDecoder().decode(b.subarray(0,4)),'FORM');assert.equal(v.getUint32(4),b.length-8);
  assert.equal(v.getUint16(26),16);assert.equal(v.getInt16(54),-32768);assert.equal(v.getInt16(56),32767);
  const decoded=decodePcm(b,'AIFF');assert.equal(decoded.sampleRate,rate);assert.equal(decoded.channels,2);
  assert.deepEqual([...decoded.samples].map(quantizePcm16),[-32768,32767,16384,-8192,0,1]);
 }
});
test('AIFF supports resampling, mono conversion and cancellation through registry',async()=>{
 const file=new File([await readFile(new URL('./fixtures/tone.wav',import.meta.url))],'tone.wav');
 const result=await audioCodec.run({file,format:'AIFF',quality:90,audio:{sampleRate:16000,channels:1}},()=>{});
 const decoded=decodePcm(new Uint8Array(await result.blob.arrayBuffer()),'AIFF');
 assert.equal(decoded.sampleRate,16000);assert.equal(decoded.channels,1);assert.equal(decoded.samples.length,1600);
 const signal=AbortSignal.abort();await assert.rejects(audioCodec.run({file,format:'AIFF',quality:90},()=>{},{signal,stage:()=>{}}),{name:'AbortError'});
});
