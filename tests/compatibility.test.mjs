import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compatibilityWarnings} from '../src/lib/compatibility.ts';
import {audioBitrates,validateAudioEncoding} from '../src/lib/audio-formats.ts';
test('label warnings are non-blocking, specific and do not flag known MIME aliases',()=>{
 assert.deepEqual(compatibilityWarnings(new File(['x'],'a.png',{type:'image/png'}),'PNG'),[]);
 assert.deepEqual(compatibilityWarnings(new File(['x'],'a.wav',{type:'audio/x-wav'}),'WAV'),[]);
 const warnings=compatibilityWarnings(new File(['x'],'wrong.zip',{type:'text/plain'}),'PNG');
 assert.equal(warnings.length,2);assert.match(warnings[0],/extension.*PNG/i);assert.match(warnings[1],/MIME.*PNG/i);
 assert.deepEqual(compatibilityWarnings(new File(['x'],'extensionless'),'PNG'),[]);
});
test('encoder bitrate constraints are per codec and quality mode ignores unused bitrate',()=>{
 assert.ok(audioBitrates('MP3',22050).includes(8));assert.ok(!audioBitrates('MP3',22050).includes(320));
 assert.ok(audioBitrates('MP3',48000).includes(40));assert.ok(audioBitrates('AAC',48000).includes(512));
 assert.doesNotThrow(()=>validateAudioEncoding('AAC',48000,512,'bitrate'));
 assert.doesNotThrow(()=>validateAudioEncoding('MP3',48000,129,'quality'));
 assert.doesNotThrow(()=>validateAudioEncoding('WAV',48000,0,'bitrate'));
 assert.throws(()=>validateAudioEncoding('AAC',48000,100000,'bitrate',60),/Safety limit:.*lower bitrate/i);
 for(const [format,rate,bitrate] of [['MP3',22050,320],['MP3',48000,129],['OPUS',48000,511],['AAC',48000,NaN],['OGG',48000,-1]])
  assert.throws(()=>validateAudioEncoding(format,rate,bitrate,'bitrate'),/bitrate/i);
});
