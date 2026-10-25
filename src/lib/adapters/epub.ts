import type { EngineAdapter } from '../engine-types.ts';
import type { EngineContext } from '../codec-registry.ts';
import { decodeZip, type Entry } from './archive.ts';
import { outputName } from '../results.ts';

const MAX=64*1024**2, TEXT_MAX=16*1024**2;
const utf8=new TextDecoder('utf-8',{fatal:true}),encoder=new TextEncoder();
function fail(message:string):never {throw new Error(message);}
const read=(entry:Entry)=>utf8.decode(entry.data);

function entities(source:string) {
	return source.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos|nbsp);/g,(_,value:string)=>{
		const named:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
		if(named[value]!==undefined)return named[value];
		const code=value.startsWith('#x')?parseInt(value.slice(2),16):parseInt(value.slice(1),10);
		if(!Number.isInteger(code)||code<=0||code>0x10ffff||(code>=0xd800&&code<=0xdfff))fail('EPUB contains an invalid numeric character reference.');
		return String.fromCodePoint(code);
	});
}
function xmlSafe(xml:string) {
	if(/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml))fail('EPUB external entities and DTDs are not supported.');
	if(xml.length>8*1024**2)fail('EPUB XML resource exceeds the 8 MiB text parsing budget.');
}
function attrs(tag:string) {
	const found:Record<string,string>={};
	for(const match of tag.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/gs)){
		if(Object.hasOwn(found,match[1]))fail('EPUB contains duplicate XML attributes.');
		found[match[1]]=entities(match[3]);
	}
	return found;
}
function resolve(base:string,href:string) {
	const clean=href.split(/[?#]/,1)[0];
	if(!clean || /%2f|%5c/i.test(clean)||/^[a-z][\w+.-]*:/i.test(clean)||clean.startsWith('/')||clean.includes('\\'))fail('EPUB resource reference is unsafe.');
	let decoded:string;
	try{decoded=decodeURIComponent(clean);}catch{fail('EPUB has an invalid encoded path.');}
	const parts=base.split('/').slice(0,-1);
	for(const part of decoded.split('/')){
		if(!part||part==='.')continue;
		if(part==='..'){if(!parts.length)fail('EPUB path escapes the publication root.');parts.pop();}
		else if(/[\x00-\x1f\x7f\\:]/.test(part))fail('EPUB resource path is unsafe.');
		else parts.push(part);
	}
	return parts.join('/');
}
function bodyText(document:string) {
	xmlSafe(document);
	const body=/<(?:[\w.-]+:)?body\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?body\s*>/i.exec(document)?.[1];
	if(body===undefined)fail('EPUB XHTML chapter does not contain a body.');
	const result=body
		.replace(/<!--[\s\S]*?-->/g,'')
		.replace(/<(script|style|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
		.replace(/<br\b[^>]*\/?>/gi,'\n')
		.replace(/<\/?(?:h[1-6]|p|div|section|article|li|ul|ol|blockquote|pre|table|tr|hr)\b[^>]*>/gi,'\n')
		.replace(/<[^>]*>/g,'');
	const normalized=entities(result).replace(/\r/g,'').replace(/[\t ]+/g,' ').split('\n').map(s=>s.trim()).join('\n')
		.replace(/\n{3,}/g,'\n\n').trim();
	return normalized;
}

async function readBook(file:File,job:EngineContext) {
	job.signal.throwIfAborted();
	if(!file.size||file.size>MAX)fail('EPUB must be nonempty and no larger than 64 MiB.');
	const bytes=new Uint8Array(await file.arrayBuffer());
	const entries=await decodeZip(bytes);
	const byName=new Map(entries.filter(e=>!e.directory).map(e=>[e.name,e]));
	if(read(byName.get('mimetype')??fail('EPUB lacks its mandatory mimetype entry.'))!=='application/epub+zip')fail('Invalid EPUB mimetype entry.');
	const container=read(byName.get('META-INF/container.xml')??fail('EPUB lacks META-INF/container.xml.'));
	xmlSafe(container);
	const root=/<(?:[\w.-]+:)?rootfile\b([^>]*?)\/?>/i.exec(container);
	if(!root)fail('EPUB has no root package document.');
	const rootAttrs=attrs(root[1]);
	if(rootAttrs['media-type']!=='application/oebps-package+xml')fail('Unsupported EPUB package document type.');
	const path=resolve('',rootAttrs['full-path']??'');
	const opf=read(byName.get(path)??fail('EPUB package document is missing.'));
	xmlSafe(opf);
	const manifest=/<(?:[\w.-]+:)?manifest\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?manifest\s*>/i.exec(opf)?.[1];
	const spine=/<(?:[\w.-]+:)?spine\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?spine\s*>/i.exec(opf)?.[1];
	if(!manifest||!spine)fail('EPUB package is missing its manifest or spine.');
	const items=new Map<string,{href:string;type:string}>();
	for(const item of manifest.matchAll(/<(?:[\w.-]+:)?item\s+([^>]*?)\/?>/gi)){
		const a=attrs(item[1]);if(!a.id||!a.href||!a['media-type']||items.has(a.id))fail('Invalid or duplicate EPUB manifest item.');
		items.set(a.id,{href:resolve(path,a.href),type:a['media-type']});
	}
	const chapters:string[]=[];
	for(const itemref of spine.matchAll(/<(?:[\w.-]+:)?itemref\s+([^>]*?)\/?>/gi)){
		job.signal.throwIfAborted();
		const a=attrs(itemref[1]);if(a.linear==='no')continue;
		const item=items.get(a.idref??'');if(!item||item.type!=='application/xhtml+xml')fail('EPUB spine references an unsupported or missing XHTML chapter.');
		const entry=byName.get(item.href);if(!entry)fail('EPUB spine chapter is missing from the archive.');
		const text=bodyText(read(entry));if(text)chapters.push(text);
		if(chapters.join('\n\n').length>TEXT_MAX)fail('EPUB extracted text exceeds the 16 MiB budget.');
	}
	if(!chapters.length)fail('EPUB has no readable XHTML chapters in its reading order.');
	const result=chapters.join('\n\n')+'\n';
	if(encoder.encode(result).length>TEXT_MAX)fail('EPUB extracted text exceeds the 16 MiB budget.');
	return {text:result,chapters:chapters.length};
}

export const epubCodec:EngineAdapter={
	async inspect(file,stage,_verified,context){
		const job=context??{signal:new AbortController().signal,stage};
		stage('reading');const book=await readBook(file,job);stage('verifying');
		return {info:{format:'EPUB',mime:'application/epub+zip',category:'ebook',entries:book.chapters},
			outputs:['TXT'],preview:null,
			warnings:['EPUB → TXT extracts readable text in spine order. Images, typography, CSS and page design are not preserved.']};
	},
	async run(request,stage,context){
		if(request.format!=='TXT')fail('Only EPUB to TXT is implemented.');
		const job=context??{signal:new AbortController().signal,stage};
		stage('reading');const book=await readBook(request.file,job);stage('encoding');
		const blob=new Blob([book.text],{type:'text/plain'});
		stage('verifying');
		if(utf8.decode(new Uint8Array(await blob.arrayBuffer()))!==book.text)fail('EPUB text output verification failed.');
		return {blob,name:outputName(request.file.name,'TXT'),format:'TXT',mime:'text/plain'};
	}
};
