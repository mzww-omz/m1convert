import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeZip} from '../src/lib/adapters/archive.ts';
import {epubCodec} from '../src/lib/adapters/epub.ts';
import {detectFormat} from '../src/lib/registry.ts';

const enc=new TextEncoder(),entry=(name,data)=>({name,data:enc.encode(data),directory:false,mtime:0});
async function epub({chapter='<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>One</h1><p>Hello &amp; world.</p></body></html>',root='OPS/package.opf',mimetype='application/epub+zip'}={}) {
	const files=[
		entry('mimetype',mimetype),
		entry('META-INF/container.xml',`<?xml version="1.0"?><container><rootfiles><rootfile full-path="${root}" media-type="application/oebps-package+xml"/></rootfiles></container>`),
		entry('OPS/package.opf','<package><manifest><item id="first" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="second" href="chapter2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>'),
		entry('OPS/chapter1.xhtml',chapter),
		entry('OPS/chapter2.xhtml','<html><body><p>Second chapter.</p><p>Last line.</p></body></html>')
	];
	return new File([await encodeZip(files,false)],'book.epub',{type:'application/epub+zip'});
}
test('EPUB content signature wins over ZIP and exports reading-order text',async()=>{
	const f=await epub(),head=new Uint8Array(await f.slice(0,100).arrayBuffer());
	assert.equal(detectFormat(head)?.id,'EPUB');
	const analysis=await epubCodec.inspect(f,()=>{});
	assert.equal(analysis.info.category,'ebook');assert.deepEqual(analysis.outputs,['TXT','HTML']);assert.equal(analysis.info.entries,2);
	const result=await epubCodec.run({file:f,format:'TXT',quality:90},()=>{});
	assert.equal(result.name,'book.txt');assert.equal(result.mime,'text/plain');
	const text=await result.blob.text();
	assert.match(text,/One\n\nHello & world\.\n\nSecond chapter\.\n\nLast line\./);
});
test('EPUB refuses missing package, DTDs, broken spine and invalid output requests',async()=>{
	for(const spec of [
		{root:'../secret.opf'},
		{root:'OPS/missing.opf'},
		{chapter:'<!DOCTYPE html><html><body><p>hi</p></body></html>'},
		{mimetype:'wrong'}
	]){
		const file=await epub(spec);
		await assert.rejects(()=>epubCodec.inspect(file,()=>{}));
	}
	const valid=await epub();
	await assert.rejects(()=>epubCodec.run({file:valid,format:'PDF',quality:90},()=>{}),/Only EPUB to TXT or HTML/);
});
