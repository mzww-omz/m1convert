import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectAudioBytes} from '../src/lib/audio-validation.ts';
import {audioCodec} from '../src/lib/adapters/audio-codec.ts';
import {decodePcm} from '../src/lib/adapters/pcm.ts';
const noop=()=>{};
export const fixture=async ext=>new File([await readFile(new URL('./fixtures/audio/music.'+ext,import.meta.url))],'music.'+ext);
test('compressed contents and stream codec determine format, not filenames or MIME',async()=>{
 for(const [ext,id] of [['mp3','MP3'],['flac','FLAC'],['ogg','OGG'],['opus','OPUS'],['aac','AAC'],['m4a','M4A']]) {
  const file=await fixture(ext),bytes=new Uint8Array(await file.arrayBuffer());assert.equal(inspectAudioBytes(file,bytes).format,id);
  assert.throws(()=>inspectAudioBytes(new File([file],'spoof.zip'),bytes),/extension/i);
  assert.throws(()=>inspectAudioBytes(new File([file],file.name,{type:'image/png'}),bytes),/MIME/i);
 }
});
test('complete compressed structures reject truncation, checksum corruption and invalid budgets',async()=>{
 for(const ext of ['mp3','flac','ogg','opus','aac','m4a']) {
  const f=await fixture(ext),b=new Uint8Array(await f.arrayBuffer());
  if(ext!=='flac') assert.throws(()=>inspectAudioBytes(f,b.subarray(0,-3)),/corrupt|truncat|length|audio|MP3|AAC|Ogg|MP4/i);
  if(['ogg','opus'].includes(ext)) {b[b.length-5]^=1;assert.throws(()=>inspectAudioBytes(f,b),/checksum/i);}
 }
 const f=await fixture('flac'),b=new Uint8Array(await f.arrayBuffer());b[18]=255;b[19]=255;
 assert.throws(()=>inspectAudioBytes(f,b),/rate|channel|sample|FLAC|limit/i);
});
test('M4A sample tables are bounded before native library parsing and non-AAC sample entries are rejected',async()=>{
 const f=await fixture('m4a'),source=Buffer.from(await f.arrayBuffer()),i=source.indexOf('stsz');assert.ok(i>0);
 const bad=Buffer.from(source);bad.writeUInt32BE(0xffffffff,i+12);assert.throws(()=>inspectAudioBytes(f,bad),/table|count|limit|MP4/i);
 const huge=Buffer.from(source);huge.writeUInt32BE(0xffffffff,i+8);assert.throws(()=>inspectAudioBytes(f,huge),/size|table|MP4/i);
 const codec=Buffer.from(source);codec.write('alac',codec.indexOf('mp4a'));assert.throws(()=>inspectAudioBytes(f,codec),/AAC|codec/i);
});
test('WASM MP3 FLAC Vorbis and Opus inputs decode to bounded real WAV samples',async()=>{
 for(const ext of ['mp3','flac','ogg','opus']) {
  const file=await fixture(ext),analysis=await audioCodec.inspect(file,noop);
  assert.equal(analysis.info.category,'audio');assert.equal(analysis.info.channels,2);assert.equal(analysis.info.sampleRate,48000);
  assert.ok(Math.abs(analysis.info.duration-2)<.08);
  const result=await audioCodec.run({file,format:'WAV',quality:90},noop),pcm=decodePcm(new Uint8Array(await result.blob.arrayBuffer()),'WAV');
  assert.equal(pcm.channels,2);assert.ok(pcm.samples.some(v=>Math.abs(v)>.1));assert.ok(Math.abs(pcm.samples.length/2/48000-2)<.08);
 }
});
test('every WASM output is genuine, re-decodable audio and uses requested channels/rate',async()=>{
 const file=await fixture('wav');
 for(const format of ['MP3','FLAC','OGG','OPUS']) {
  const result=await audioCodec.run({file,format,quality:80,audio:{sampleRate:48000,channels:1,bitrate:128,mode:'bitrate'}},noop);
  const output=new File([result.blob],result.name,{type:result.mime}),info=await audioCodec.inspect(output,noop);
  assert.equal(info.info.format,format);assert.equal(info.info.channels,1);assert.equal(info.info.sampleRate,48000);assert.ok(Math.abs(info.info.duration-2)<.08);
 }
});
