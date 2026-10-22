import { checkDimensions } from '../image-format.ts';

// Deliberately static subset: no CSS, text/fonts, references, entities or embedded resources.
const tags = new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','defs','linearGradient','radialGradient','stop','clipPath']);
const attributes = new Set(['id','viewBox','width','height','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','d','points','fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','opacity','transform','gradientTransform','gradientUnits','offset','stop-color','stop-opacity','clip-path','clip-rule','preserveAspectRatio','version']);
const invalid = (): never => { throw new Error('SVG/XML is unsafe, malformed or outside the supported static SVG subset (no CSS, text, entities or external references).'); };
export function svgInfo(bytes: Uint8Array) {
	if (bytes.length > 1024*1024) throw new Error('SVG exceeds the 1 MiB vector limit.');
	let source: string;
	try { source = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { return invalid(); }
	source = source.replace(/^\uFEFF/,'').replace(/^\s*<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>/i,'');
	if (/[&\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(source) || source.includes('<!') || source.includes('<?')) return invalid();
	const stack: string[] = [], root: Record<string,string> = {};
	let p=0, nodes=0, closed=false;
	while (p < source.length) {
		const whitespace = /^\s+/.exec(source.slice(p)); if (whitespace) { p += whitespace[0].length; continue; }
		const token = /^<(\/)?([A-Za-z]+)([^<>]*?)(\/?)>/.exec(source.slice(p));
		if (!token || ++nodes > 10000 || token[0].length > 65536 || closed) return invalid();
		p += token[0].length;
		const [,end,tag,raw,selfClosing] = token;
		if (!tags.has(tag)) return invalid();
		if (end) { if (raw.trim() || selfClosing || stack.pop() !== tag) return invalid(); if (!stack.length) closed=true; continue; }
		if (!stack.length && (tag !== 'svg' || nodes !== 1)) return invalid();
		if (tag === 'svg' && stack.length) return invalid();
		const attrs: Record<string,string> = {};
		let rest=raw;
		while (rest.trim()) {
			const a = /^\s+([A-Za-z][A-Za-z0-9-]*)(?:\s*=\s*)(["'])([^<>]*?)\2/.exec(rest);
			if (!a || Object.hasOwn(attrs,a[1])) return invalid();
			const [,name,,value] = a;
			if (name === 'xmlns') { if (tag !== 'svg' || value !== 'http://www.w3.org/2000/svg') return invalid(); }
			else if (!attributes.has(name)) return invalid();
			if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z_][\w-]*\)$/.test(value)) return invalid();
			if (/[\\:;@]/.test(value) && name !== 'xmlns') return invalid();
			attrs[name]=value; rest=rest.slice(a[0].length);
		}
		if (nodes === 1) Object.assign(root,attrs);
		if (!selfClosing) { stack.push(tag); if (stack.length > 64) return invalid(); } else if (!stack.length) closed=true;
	}
	if (!closed || stack.length) return invalid();
	let ratio=0, vw=0, vh=0;
	if (root.viewBox) {
		const box = root.viewBox.trim().split(/[\s,]+/).map(Number);
		if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) return invalid();
		[vw,vh]=box.slice(2); ratio=vw/vh;
	}
	const length = (s?: string) => { if (s === undefined) return 0; if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/.test(s)) return invalid(); return parseFloat(s); };
	let width=length(root.width), height=length(root.height);
	if (!width && !height) { width=vw; height=vh; }
	else if (!width) width=ratio ? height*ratio : 300;
	else if (!height) height=ratio ? width/ratio : 150;
	width=Math.round(width); height=Math.round(height);
	checkDimensions(width,height,bytes.length);
	// Explicit dimensions make native rasterization deterministic even for viewBox-only input.
	const svg=source.replace(/<svg\b[^>]*>/, match => match.replace(/\s+(?:width|height)\s*=\s*(["']).*?\1/g,'').replace(/\s+xmlns\s*=\s*(["']).*?\1/g,'').replace(/\/? >$/,'>'));
	const normalized=svg.replace(/<svg\b/,`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`);
	return { width,height,svg:normalized };
}
