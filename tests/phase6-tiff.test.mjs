import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeTiff,tiffInfo} from '../src/lib/adapters/tiff.ts';

// Hand-authored classic TIFF: independently specified IFD and encoded sample bytes.
export function tiffFixture({little=true,bits=8,photo=2,channels=3,compression=1,payload=Uint8Array.of(255,0,128),width=1,height=1}={}) {
 const tags=[[256,4,1,width],[257,4,1,height],[258,3,channels,bits],[259,3,1,compression],[262,3,1,photo],[273,4,1,0],[277,3,1,channels],[278,4,1,height],[279,4,1,payload.length],[284,3,1,1]];
 const end=8+2+tags.length*12+4,pixels=end+(channels>2?channels*2:0),b=new Uint8Array(pixels+payload.length),v=new DataView(b.buffer);
 b.set(little?[73,73,42,0]:[77,77,0,42]);v.setUint32(4,8,little);v.setUint16(8,tags.length,little);
 tags[5][3]=pixels;
 tags.forEach(([tag,type,n,value],i)=>{const p=10+12*i;v.setUint16(p,tag,little);v.setUint16(p+2,type,little);v.setUint32(p+4,n,little);
  if(tag===258&&channels>2){v.setUint32(p+8,end,little);for(let c=0;c<channels;c++)v.setUint16(end+2*c,bits,little);}
  else if(type===3)v.setUint16(p+8,value,little);else v.setUint32(p+8,value,little);
 });b.set(payload,pixels);return b;
}
test('TIFF decodes PackBits RGB, white/black grayscale and 16-bit samples in both byte orders',()=>{
 for(const little of [false,true]) {
  const rgb=tiffFixture({little,compression:32773,payload:Uint8Array.of(2,255,0,128)});
  assert.deepEqual([...decodeTiff(rgb).data],[255,0,128,255]);
  for(const photo of [0,1])for(const bits of [8,16]) {
   const b=tiffFixture({little,photo,bits,channels:1,payload:bits===8?Uint8Array.of(128):Uint8Array.from(little?[0,128]:[128,0])});
   assert.deepEqual([...decodeTiff(b).data],photo===0?[127,127,127,255]:[128,128,128,255]);
  }
  const rgb16=tiffFixture({little,bits:16,payload:Uint8Array.from(little?[255,255,0,0,0,128]:[255,255,0,0,128,0])});
  assert.deepEqual([...decodeTiff(rgb16).data],[255,0,128,255]);
 }
 const run=tiffFixture({width:2,compression:32773,payload:Uint8Array.of(251,12)});
 assert.deepEqual([...decodeTiff(run).data],[12,12,12,255,12,12,12,255]);
});
test('TIFF PackBits rejects truncated runs, expansion overflow and underflow before decode',()=>{
 for(const payload of [[2,1],[254],[252,1],[0,1],[128]]) {
  const b=tiffFixture({compression:32773,payload:Uint8Array.from(payload)});
  assert.throws(()=>tiffInfo(b),/TIFF|PackBits/);
 }
});
