import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeTiff,tiffInfo} from '../src/lib/adapters/tiff.ts';
test('TIFF refuses predictors, reversed fill order and signed samples rather than misrendering',()=>{
 const image={width:1,height:1,data:Uint8ClampedArray.of(255,0,128,64)};
 for(const [tag,value] of [[317,2],[266,2],[339,2]]) {
  const bytes=encodeTiff(image),v=new DataView(bytes.buffer);
  // Repurpose the PlanarConfiguration entry; default chunky layout remains valid.
  for(let p=10;p<10+13*12;p+=12)if(v.getUint16(p,true)===(tag===339?339:284)) {v.setUint16(p,tag,true);v.setUint16(p+8,value,true);}
  assert.throws(()=>tiffInfo(bytes),/TIFF/);
 }
});
