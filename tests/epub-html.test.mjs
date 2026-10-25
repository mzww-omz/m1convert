import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeZip,crc32} from '../src/lib/adapters/archive.ts';
import {epubCodec} from '../src/lib/adapters/epub.ts';
const enc=new TextEncoder();
const entry=(name,data)=>({name,data:typeof data==='string'?enc.encode(data):data,directory:false,mtime:0});
function png() {
	const pixel=new Uint8Array([137,80,78,71,13,10,26,10]);
	const chunk=(name,bytes)=>{
		const tag=enc.encode(name),output=new Uint8Array(12+bytes.length),view=new DataView(output.buffer);
		view.setUint32(0,bytes.length);output.set(tag,4);output.set(bytes,8);
		view.setUint32(8+bytes.length,crc32(output.subarray(4,8+bytes.length)));
		return output;
	};
	const ihdr=new Uint8Array(13);new DataView(ihdr.buffer).setUint32(0,1);new DataView(ihdr.buffer).setUint32(4,1);ihdr[8]=8;ihdr[9]=6;
	const idat=new Uint8Array([120,156,99,248,207,192,240,31,0,5,0,1,255,0,0]); // ignored by signature tests
	return Buffer.concat([pixel,chunk('IHDR',ihdr),chunk('IDAT',idat),chunk('IEND',new Uint8Array())]);
}
async function make({malicious=false,externalCss=false,imageOnly=false}={}) {
	const first='<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Demo</title><link rel="stylesheet" href="book.css"/></head>'+
		'<body>'+(imageOnly?'<img src="pixel.png" alt="cover"/>':'<h1 id="start">Chapter 1</h1><p class="accent">CSS and an image.</p><img src="pixel.png" alt="cover"/>')+
		(imageOnly?'':'<a href="two.xhtml#next">Next</a>')+
		(malicious?'<script>alert(1)</script><iframe src="https://leak.example/"></iframe><img src="https://leak.example/x" onerror="alert(2)"/>':'')+
		'</body></html>';
	const second=imageOnly?'<html><body><img src="pixel.png" alt="another"/></body></html>':'<html><body><h2 id="next">Chapter 2</h2><a href="one.xhtml#start">Previous</a></body></html>';
	const css='@import "extra.css";.epub-image{background-image:url("pixel.png")}'+
		(externalCss?'@import url("https://leak.example/bad.css");p{background:url(https://leak.example/track)}':'');
	const files=[
		entry('mimetype','application/epub+zip'),
		entry('META-INF/container.xml','<container><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
		entry('OPS/book.opf','<package><metadata><dc:title>My &amp; Book</dc:title><dc:language>ja</dc:language></metadata><manifest><item id="a" href="one.xhtml" media-type="application/xhtml+xml"/><item id="b" href="two.xhtml" media-type="application/xhtml+xml"/><item id="css" href="book.css" media-type="text/css"/><item id="more" href="extra.css" media-type="text/css"/><item id="pic" href="pixel.png" media-type="image/png"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'),
		entry('OPS/one.xhtml',first),entry('OPS/two.xhtml',second),entry('OPS/book.css',css),entry('OPS/extra.css','.accent{color:rgb(12,34,56)}'),entry('OPS/pixel.png',png())
	];
	return new File([await encodeZip(files,false)],'illustrated.epub',{type:'application/epub+zip'});
}
test('EPUB → standalone HTML keeps safe XHTML, embedded CSS/images and ordered chapters',async()=>{
	const file=await make();
	const inspection=await epubCodec.inspect(file,()=>{});
	assert.deepEqual(inspection.outputs,['TXT','HTML']);
	assert.equal(inspection.info.entries,2);
	const result=await epubCodec.run({file,format:'HTML',quality:90},()=>{});
	assert.equal(result.name,'illustrated.html');assert.equal(result.mime,'text/html');
	const html=await result.blob.text();
	assert.match(html,/<!doctype html>/);
	assert.match(html,/<html lang="ja">/);
	assert.match(html,/<title>My &amp; Book<\/title>/);
	assert.match(html,/Chapter 1[\s\S]*Chapter 2/);
	assert.match(html,/data:image\/png;base64,/);
	assert.match(html,/color:rgb\(12,34,56\)/);
	assert.match(html,/href="#epub-chapter-2--next"/);
	assert.match(html,/id="epub-chapter-1--start"/);
	assert.match(html,/Content-Security-Policy/);
	assert.doesNotMatch(html,/file:\/\/|src="https?:/i);
	const txt=await epubCodec.run({file,format:'TXT',quality:90},()=>{});
	assert.match(await txt.blob.text(),/Chapter 1[\s\S]*Chapter 2/);
});
test('EPUB → HTML strips scripts, event attributes, external resources and CSS imports',async()=>{
	const file=await make({malicious:true,externalCss:true});
	const result=await epubCodec.run({file,format:'HTML',quality:90},()=>{});
	const html=await result.blob.text();
	assert.doesNotMatch(html,/<script\b|<iframe\b|onerror=|https:\/\/leak\.example/i);
	assert.match(html,/url\("data:,"\)/);
	assert.match(html,/Content-Security-Policy/);
});
test('EPUB → HTML rejects unsupported output',async()=>{
	const file=await make();
	await assert.rejects(()=>epubCodec.run({file,format:'PDF',quality:90},()=>{}),/Only EPUB to TXT or HTML/);
});
test('image-only EPUB is available as HTML, not an empty TXT',async()=>{
	const file=await make({imageOnly:true});
	const analysis=await epubCodec.inspect(file,()=>{});
	assert.deepEqual(analysis.outputs,['HTML']);
	const result=await epubCodec.run({file,format:'HTML',quality:90},()=>{});
	assert.match(await result.blob.text(),/data:image\/png;base64,/);
	await assert.rejects(()=>epubCodec.run({file,format:'TXT',quality:90},()=>{}),/no extractable text/);
});
