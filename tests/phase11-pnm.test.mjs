import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePnm,encodePnm,pnmInfo} from '../src/lib/adapters/pnm.ts';
import {detectFormat} from '../src/lib/registry.ts';
const enc=new TextEncoder();
const image={width:2,height:1,data:new Uint8ClampedArray([255,0,0,255,0,255,0,128])};
test('Netpbm P4/P5/P6 encoded files re-decode to original dimensions and expected pixels',()=>{
	for(const format of ['PBM','PGM','PPM']){
		const bytes=encodePnm(image,format);
		assert.equal(pnmInfo(bytes).format,format);
		assert.equal(detectFormat(bytes)?.id,format);
		const decoded=decodePnm(bytes);
		assert.equal(decoded.width,2);assert.equal(decoded.height,1);assert.equal(decoded.data.length,8);
		assert.equal(decoded.data[3],255);assert.equal(decoded.data[7],255);
	}
	const ppm=decodePnm(encodePnm(image,'PPM'));
	assert.deepEqual([...ppm.data.slice(0,4)],[255,0,0,255]);
	assert.ok(ppm.data[4]>0&&ppm.data[5]===255&&ppm.data[6]>0);
});
test('Netpbm ASCII variants and 16-bit pixels decode with comments and scaling',()=>{
	const pbm=decodePnm(enc.encode('P1\n# comment\n2 1\n1 0\n'));
	assert.deepEqual([...pbm.data],[0,0,0,255,255,255,255,255]);
	const pgm=decodePnm(enc.encode('P2\n2 1\n15\n0 15\n'));
	assert.deepEqual([...pgm.data],[0,0,0,255,255,255,255,255]);
	const ppm=decodePnm(enc.encode('P3\n1 1\n65535\n65535 0 0\n'));
	assert.deepEqual([...ppm.data],[255,0,0,255]);
	const p6=new Uint8Array([...enc.encode('P6\n1 1\n65535\n'),255,255,0,0,0,0]);
	assert.deepEqual([...decodePnm(p6).data],[255,0,0,255]);
});
test('Netpbm rejects truncated, excessive and malformed rasters',()=>{
	for(const content of [
		'P3\n1 1\n255\n1 2','P2\n1 1\n255\n999','P1\n1 1\n1 0',
		'P6\n1 1\n255\n','P1\n0 1\n0','P2\n1 1\n0\n0'
	])assert.throws(()=>pnmInfo(enc.encode(content)));
});
