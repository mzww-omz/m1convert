import test from 'node:test';
import assert from 'node:assert/strict';
import {streamArchiveCodec} from '../src/lib/adapters/archive-stream.ts';
import {decodeZip} from '../src/lib/adapters/archive.ts';
import {detectFormat} from '../src/lib/registry.ts';
const enc=new TextEncoder();
function ar(entries){
	const parts=[enc.encode('!<arch>\n')];
	for(const [name,content] of entries){
		const payload=enc.encode(content),field=(v,n)=>String(v).padEnd(n,' ');
		const h=enc.encode(field(name.endsWith('/')?name:name+'/',16)+field(0,12)+field(0,6)+field(0,6)+field('100644',8)+field(payload.length,10)+'`\n');
		assert.equal(h.length,60);
		parts.push(h,payload);if(payload.length%2)parts.push(enc.encode('\n'));
	}
	return new Uint8Array(Buffer.concat(parts.map(p=>Buffer.from(p))));
}
test('Unix ar and Debian ar-like archives convert to ZIP without losing payloads',async()=>{
	const bytes=ar([['debian-binary','2.0\n'],['control.tar.gz','control'],['data.tar.xz','payload']]);
	assert.equal(detectFormat(bytes)?.id,'AR');
	const file=new File([bytes],'package.deb',{type:'application/vnd.debian.binary-package'});
	const inspected=await streamArchiveCodec.inspect(file,()=>{});
	assert.equal(inspected.info.format,'AR');assert.equal(inspected.info.entries,3);
	assert.ok(inspected.outputs.includes('ZIP'));
	const output=await streamArchiveCodec.run({file,format:'ZIP',quality:90},()=>{});
	assert.equal(output.format,'ZIP');
	const expanded=await decodeZip(new Uint8Array(await output.blob.arrayBuffer()));
	assert.deepEqual(expanded.map(e=>e.name),['debian-binary','control.tar.gz','data.tar.xz']);
	assert.equal(new TextDecoder().decode(expanded[2].data),'payload');
});
test('Unix ar rejects unsafe paths and truncated entries',async()=>{
	const malicious=ar([['../evil','x']]);
	await assert.rejects(()=>streamArchiveCodec.inspect(new File([malicious],'bad.ar'),()=>{}),/Unsafe archive/);
	const truncated=ar([['file.txt','hi']]).slice(0,-1);
	await assert.rejects(()=>streamArchiveCodec.inspect(new File([truncated],'bad.ar'),()=>{}),/Truncated|Invalid/);
});
