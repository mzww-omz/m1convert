import type { EpubBook } from './epub.ts';

const MAX_HTML_BYTES = 96 * 1024 ** 2;
const MAX_XML_CHARS = 8 * 1024 ** 2;
const MAX_CSS_CHARS = 4 * 1024 ** 2;
const allowed = new Set('a article aside blockquote b br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark nav ol p pre q rb rp rt rtc ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr'.split(' '));
const blocked = new Set('script iframe frame frameset object embed form input button select textarea svg math canvas audio video template noscript'.split(' '));
const voidTags = new Set(['br','hr','img','col','wbr','meta','link','input','source','area','base']);
const decoder = new TextDecoder('utf-8',{fatal:true});
const encoder = new TextEncoder();

function fail(reason:string):never { throw new Error('EPUB HTML: '+reason); }
function escapeText(value:string) { return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeAttr(value:string) { return escapeText(value).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function xmlText(value:string) {
	const named:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',copy:'\u00a9',reg:'\u00ae',mdash:'\u2014',ndash:'\u2013',hellip:'\u2026'};
	return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(whole,ref:string)=>{
		if(Object.hasOwn(named,ref))return named[ref];
		if(!ref.startsWith('#'))return whole;
		const code=ref[1].toLowerCase()==='x'?Number.parseInt(ref.slice(2),16):Number.parseInt(ref.slice(1),10);
		if(!Number.isInteger(code)||code<=0||code>0x10ffff||(code>=0xd800&&code<=0xdfff))fail('invalid numeric character reference');
		return String.fromCodePoint(code);
	});
}
function attrs(rest:string) {
	const result:Record<string,string>={};
	let source=rest;
	while(source.trim()){
		const found=/^\s+([\w:.-]+)\s*=\s*(["'])(.*?)\2/s.exec(source);
		if(!found)fail('malformed XHTML attribute');
		const key=found[1].toLowerCase();
		if(Object.hasOwn(result,key))fail('duplicate XHTML attribute');
		result[key]=xmlText(found[3]);
		source=source.slice(found[0].length);
	}
	return result;
}
type Token={kind:'text';value:string}|{kind:'tag';name:string;closing:boolean;selfClosing:boolean;attrs:Record<string,string>};
function* tokenize(markup:string):Generator<Token> {
	if(markup.length>MAX_XML_CHARS)fail('XHTML resource exceeds 8 MiB');
	if(/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(markup))fail('DTD and external entity declarations are not allowed');
	let pos=0,count=0;
	while(pos<markup.length){
		if(++count>120_000)fail('XHTML contains too many tokens');
		const open=markup.indexOf('<',pos);
		if(open<0){yield {kind:'text',value:markup.slice(pos)};break;}
		if(open>pos)yield {kind:'text',value:markup.slice(pos,open)};
		if(markup.startsWith('<!--',open)){
			const end=markup.indexOf('-->',open+4);
			if(end<0)fail('unclosed XHTML comment');
			pos=end+3;continue;
		}
		if(markup.startsWith('<?',open)){
			const end=markup.indexOf('?>',open+2);
			if(end<0)fail('malformed XML processing instruction');
			pos=end+2;continue;
		}
		if(markup.startsWith('<![CDATA[',open)){
			const end=markup.indexOf(']]>',open+9);
			if(end<0)fail('unclosed CDATA');
			yield {kind:'text',value:markup.slice(open+9,end)};
			pos=end+3;continue;
		}
		if(markup.startsWith('<!',open))fail('unsupported XML declaration');
		let end=open+1,quote='';
		for(;end<markup.length;end++){
			const c=markup[end];
			if(quote){if(c===quote)quote='';}
			else if(c==='"'||c==="'")quote=c;
			else if(c==='>')break;
		}
		if(end===markup.length)fail('unclosed XHTML element');
		let raw=markup.slice(open+1,end).trim(),closing=false,selfClosing=false;
		if(raw.startsWith('/')){closing=true;raw=raw.slice(1).trim();}
		else if(raw.endsWith('/')){selfClosing=true;raw=raw.slice(0,-1).trimEnd();}
		const match=/^([a-zA-Z][\w:.-]*)([\s\S]*)$/.exec(raw);
		if(!match)fail('invalid XHTML element');
		const name=match[1].split(':').pop()!.toLowerCase();
		if(closing && match[2].trim())fail('invalid XHTML close tag');
		yield {kind:'tag',name,closing,selfClosing:selfClosing||voidTags.has(name),attrs:closing?{}:attrs(match[2])};
		pos=end+1;
	}
}
function pathFor(base:string,href:string) {
	const plain=href.split(/[?#]/,1)[0];
	if(!plain||plain.startsWith('/')||plain.includes('\\')||/%2f|%5c/i.test(plain)||/^[a-z][\w+.-]*:/i.test(plain))return null;
	let decoded:string;
	try{decoded=decodeURIComponent(plain);}catch{return null;}
	const parts=base.split('/').slice(0,-1);
	for(const part of decoded.split('/')){
		if(!part||part==='.')continue;
		if(part==='..'){if(!parts.length)return null;parts.pop();}
		else if(/[\x00-\x1f\x7f\\:]/.test(part))return null;
		else parts.push(part);
	}
	return parts.join('/');
}
function binaryBase64(bytes:Uint8Array) {
	const chunks:string[]=[];
	for(let p=0;p<bytes.length;p+=12_288)chunks.push(String.fromCharCode(...bytes.subarray(p,p+12_288)));
	return btoa(chunks.join(''));
}
function checkMagic(bytes:Uint8Array,mime:string) {
	switch(mime){
		case 'image/png':return [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
		case 'image/jpeg':return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
		case 'image/gif':return bytes.length>=6&&['GIF87a','GIF89a'].includes(String.fromCharCode(...bytes.subarray(0,6)));
		case 'image/webp':return bytes.length>=12&&String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
		case 'image/avif':return bytes.length>=16&&String.fromCharCode(...bytes.subarray(4,8))==='ftyp';
		case 'font/woff':return bytes.length>=4&&String.fromCharCode(...bytes.subarray(0,4))==='wOFF';
		case 'font/woff2':return bytes.length>=4&&String.fromCharCode(...bytes.subarray(0,4))==='wOF2';
		case 'font/ttf':return bytes.length>=4&&[0,1,0,0].every((v,i)=>bytes[i]===v);
		case 'font/otf':return bytes.length>=4&&String.fromCharCode(...bytes.subarray(0,4))==='OTTO';
		default:return false;
	}
}
function embedded(book:EpubBook) {
	const manifest=new Map([...book.items.values()].map(item=>[item.href,item.type]));
	const cache=new Map<string,string>();
	return (base:string,href:string,kind:'image'|'css')=>{
		const path=pathFor(base,href);
		if(!path)return null;
		const type=manifest.get(path),entry=book.byName.get(path);
		if(!type||!entry)return null;
		const media=type==='application/font-woff'?'font/woff':type==='application/vnd.ms-opentype'?'font/otf':type;
		if(kind==='image'&&!media.startsWith('image/'))return null;
		if(!checkMagic(entry.data,media))return null;
		if(!cache.has(path))cache.set(path,'data:'+media+';base64,'+binaryBase64(entry.data));
		return cache.get(path)!;
	};
}
function cssSafe(source:string,base:string,asset:(base:string,href:string,kind:'image'|'css')=>string|null,importCss?:(href:string)=>string) {
	if(source.length>MAX_CSS_CHARS)fail('stylesheet exceeds 4 MiB');
	// Remove comments first, then imports/namespace directives. CSP blocks unrecognized external references.
	let css=source.replace(/\/\*[\s\S]*?\*\//g,'');
	const imports:string[]=[];
	css=css.replace(/@import\s+(?:url\(\s*(["']?)([^)'"\s]+)\1\s*\)|(["'])(.*?)\3)\s*;/gi,(_rule,_quote:string,uri:string,_single:string,quoted:string)=>{
		imports.push(importCss?.(uri||quoted)||'');
		return '\\0000EPUBIMPORT'+(imports.length-1)+'END';
	});
	css=css.replace(/@(?:import|namespace)\b[^;{}]*;/gi,'');
	css=css.replace(/url\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi,(_match,_quote:string,quoted:string,plain:string)=>{
		const href=(quoted??plain??'').trim();
		const uri=asset(base,href,'css');
		return uri?'url("'+uri+'")':'url("data:,")';
	});
	// CSS must never be able to close its generated <style> element.
	return css.replace(/</g,'\\3c ').replace(/\\0000EPUBIMPORT(\d+)END/g,(_match,index:string)=>imports[Number(index)]??'');
}
function chapterHtml(book:EpubBook,index:number,asset:ReturnType<typeof embedded>,pageIds:Map<string,string>) {
	const page=book.pages[index],prefix='epub-chapter-'+String(index+1);
	const fragments:string[]=[],styles:string[]=[],stack:{name:string;written:boolean;blocked:boolean;style?:string[]}[]=[];
	const cssManifest=new Set([...book.items.values()].filter(item=>item.type==='text/css').map(item=>item.href));
	const readCss=(source:string,base:string,seen:Set<string>=new Set(),depth=0):string=>{
		if(depth>8)fail('stylesheet import nesting exceeds eight levels');
		return cssSafe(source,base,asset,href=>{
			const target=pathFor(base,href);
			if(!target||!cssManifest.has(target)||seen.has(target))return '';
			const entry=book.byName.get(target);
			if(!entry)fail('imported stylesheet is missing');
			return readCss(decoder.decode(entry.data),target,new Set([...seen,target]),depth+1);
		});
	};
	let body=false,sawBody=false;
	const allowedGlobal=new Set(['id','class','title','lang','xml:lang','dir','role','style']);
	const specific=new Set(['alt','width','height','colspan','rowspan','scope','start','reversed','value','datetime','cite','abbr']);
	for(const token of tokenize(page.markup)){
		if(token.kind==='text'){
			const style=stack.findLast(s=>s.style);
			if(style){style.style!.push(token.value);continue;}
			if(body&&!stack.some(s=>s.blocked))fragments.push(escapeText(xmlText(token.value)));
			continue;
		}
		const {name,closing,selfClosing}=token;
		if(closing){
			const last=stack.pop();
			if(!last||last.name!==name)fail('XHTML close tag mismatch');
			if(last.style)styles.push(readCss(last.style.join(''),page.path));
			if(last.written)fragments.push('</'+name+'>');
			if(name==='body')body=false;
			continue;
		}
		if(stack.length>=96)fail('XHTML nesting is too deep');
		if(name==='body'){body=true;sawBody=true;}
		if(name==='link'&&stack.some(s=>s.name==='head')&&token.attrs.rel?.toLowerCase().split(/\s+/).includes('stylesheet')&&token.attrs.href){
			const resource=pathFor(page.path,token.attrs.href);
			const manifest=resource?[...book.items.values()].find(it=>it.href===resource):undefined;
			if(resource&&manifest?.type==='text/css'){
				const entry=book.byName.get(resource);
				if(!entry)fail('manifest stylesheet is missing');
				const css=decoder.decode(entry.data);
				styles.push(readCss(css,resource,new Set([resource])));
			}
		}
		const parentBlocked=stack.some(s=>s.blocked);
		const isBlocked=blocked.has(name);
		const canWrite=body&&!parentBlocked&&!isBlocked&&allowed.has(name);
		let written=false,style:string[]|undefined;
		if(name==='style')style=[];
		if(canWrite){
			const attrsOut:string[]=[];
			for(const [key,value] of Object.entries(token.attrs)){
				const target=key==='xml:lang'?'lang':key;
				if(key==='href'&&name==='a'){
					let href:string|null=null;
					if(value.startsWith('#')){
						try{href='#'+prefix+'--'+decodeURIComponent(value.slice(1));}catch{href=null;}
					}else{
						const path=pathFor(page.path,value),other=path?pageIds.get(path):undefined;
						if(other){
							const fragment=value.includes('#')?value.slice(value.indexOf('#')+1):'';
							try{href='#'+other+(fragment?'--'+decodeURIComponent(fragment):'');}catch{href=null;}
						}
					}
					if(href)attrsOut.push('href="'+escapeAttr(href)+'"');
				}else if(key==='src'&&name==='img'){
					const uri=asset(page.path,value,'image');
					if(uri)attrsOut.push('src="'+uri+'"');
				}else if(key==='id'){
					attrsOut.push('id="'+escapeAttr(prefix+'--'+value)+'"');
				}else if(key==='style'){
					const css=cssSafe(value,page.path,asset);
					if(css)attrsOut.push('style="'+escapeAttr(css)+'"');
				}else if(allowedGlobal.has(key)||specific.has(key)||/^aria-[a-z-]+$/.test(key)){
					if(key==='class'&&(value.length>2048||/[\x00-\x1f\x7f]/.test(value)))continue;
					if(key==='dir'&&!/^(ltr|rtl|auto)$/i.test(value))continue;
					if(['width','height','colspan','rowspan','start','value'].includes(key)&&!/^\d{1,5}$/.test(value))continue;
					attrsOut.push(target+'="'+escapeAttr(value)+'"');
				}
			}
			if(name!=='img'||attrsOut.some(a=>a.startsWith('src='))){
				fragments.push('<'+name+(attrsOut.length?' '+attrsOut.join(' '):'')+'>');
				written=true;
				if(selfClosing&&!voidTags.has(name))fragments.push('</'+name+'>');
			}
		}
		if(!selfClosing){
			stack.push({name,written:written&&!voidTags.has(name),blocked:parentBlocked||isBlocked,style});
		}
	}
	if(stack.length||!sawBody)fail('XHTML chapter is malformed or lacks a body');
	const html='<section class="epub-chapter" id="'+prefix+'" data-epub-chapter="'+(index+1)+'">'+fragments.join('')+'</section>';
	return {html,styles};
}
export function makeStandaloneHtml(book:EpubBook,signal:AbortSignal) {
	const asset=embedded(book),pageIds=new Map(book.pages.map((page,i)=>[page.path,'epub-chapter-'+(i+1)]));
	const bodies:string[]=[],styles:string[]=[];
	for(let index=0;index<book.pages.length;index++){
		signal.throwIfAborted();
		const page=chapterHtml(book,index,asset,pageIds);
		bodies.push(page.html);styles.push(...page.styles);
		if(bodies.join('').length+styles.join('').length>MAX_HTML_BYTES)fail('standalone HTML exceeds the 96 MiB output budget');
	}
	const safeTitle=book.title;
	const html='<!doctype html>\n<html lang="'+escapeAttr(book.language)+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
		'<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;; img-src data:; font-src data:; style-src &#39;unsafe-inline&#39;">'+
		'<title>'+escapeText(safeTitle)+'</title><style>body{max-width:50rem;margin:2.5rem auto;padding:0 1.25rem;line-height:1.6}img{max-width:100%;height:auto}.epub-chapter{margin:0 0 2rem;padding:0 0 1rem}</style>'+
		styles.map(s=>'<style>'+s+'</style>').join('')+'</head><body>'+bodies.join('\n')+'</body></html>';
	if(encoder.encode(html).length>MAX_HTML_BYTES)fail('standalone HTML exceeds the 96 MiB output budget');
	return html;
}
