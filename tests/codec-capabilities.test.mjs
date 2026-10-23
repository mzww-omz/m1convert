import {test} from 'node:test';
import assert from 'node:assert/strict';
import {engineCapabilities,detectEnvironment} from '../src/lib/codec-registry.ts';
import {imageEncoders} from '../src/lib/engines/image.ts';
import {audioEncoders,audioDecoders} from '../src/lib/engines/audio.ts';
const env={...detectEnvironment({}),wasm:true,offscreenCanvas:true,imageBitmap:true,canvasEncoding:true};
test('production image capabilities expose actual optional engines and reject unsafe WASM working sets',async()=>{
 const small=await engineCapabilities(imageEncoders,{format:'PNG',quality:90,width:128,height:80,encodedBytes:1024},env);
 assert.deepEqual(small.filter(e=>e.available).map(e=>e.id),['native-canvas','wasm-png']);
 assert.equal(small.find(e=>e.id==='wasm-png').quality.PNG,'lossless');
 const large=await engineCapabilities(imageEncoders,{format:'PNG',quality:90,width:4100,height:4100,encodedBytes:1024},env);
 assert.equal(large.find(e=>e.id==='native-canvas').available,true);
 assert.match(large.find(e=>e.id==='wasm-png').reason,/memory|budget/i);
 const noWasm=await engineCapabilities(imageEncoders,{format:'PNG',quality:90,width:2,height:2,encodedBytes:10},{...env,wasm:false});
 assert.equal(noWasm.find(e=>e.id==='wasm-png').available,false);
 assert.ok(!small.some(e=>/vips|ffmpeg-wasm/.test(e.id)),'Evaluated-only engines must not be advertised');
});
test('audio capabilities distinguish PCM, WebCodecs and libav without loading WASM or claiming native AAC',async()=>{
 const q={format:'MP3',quality:90,bitrate:128,mode:'bitrate',sampleRate:48000,channels:2,duration:2};
 const mp3=await engineCapabilities(audioEncoders,q,env);
 assert.deepEqual(mp3.filter(e=>e.available).map(e=>e.id),['wasm-libav-encode']);
 assert.equal(mp3.find(e=>e.id==='wasm-libav-encode').quality.MP3,'bitrate-or-quality');
 const aac=await engineCapabilities(audioEncoders,{...q,format:'AAC'},env);assert.ok(!aac.some(e=>e.available));
 const wav=await engineCapabilities(audioEncoders,{...q,format:'WAV'},env);assert.deepEqual(wav.filter(e=>e.available).map(e=>e.id),['builtin-pcm-encode']);
 const decode=await engineCapabilities(audioDecoders,{format:'FLAC'},env);assert.deepEqual(decode.filter(e=>e.available).map(e=>e.id),['wasm-libav-decode']);
 const unsupported=await engineCapabilities(audioEncoders,{...q,bitrate:129},env);assert.match(unsupported.find(e=>e.id==='wasm-libav-encode').reason,/bitrate/i);
});
