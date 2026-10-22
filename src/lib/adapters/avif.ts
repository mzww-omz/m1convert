import { ascii } from '../formats.ts';
import { checkDimensions } from '../image-format.ts';

export function avifInfo(bytes: Uint8Array) {
	const v = new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
	const invalid = (): never => { throw new Error('AVIF has corrupt or unsupported BMFF metadata.'); };
	let width=0,height=0,metadata=false,payload=false,config=false,boxes=0;
	function walk(start: number,end: number,depth: number) {
		if (depth > 6) return invalid();
		for (let p=start;p<end;) {
			if (p+8>end || ++boxes>4096) return invalid();
			const size=v.getUint32(p),type=ascii(bytes,p+4,4),data=p+8,next=p+size;
			if (size<8 || next>end) return invalid();
			if (type==='ftyp') {
				if (size<16 || size%4) return invalid();
				for (let b=data;b<next;b+=4) if (['avis','msf1'].includes(ascii(bytes,b,4))) throw new Error('Animated AVIF sequences are not supported.');
			}
			if (type==='moov') throw new Error('Animated AVIF sequences are not supported.');
			if (['clap','irot','imir','grid'].includes(type)) throw new Error('AVIF grids, crops and orientation transforms are not supported.');
			if (type==='meta') { if (size<12 || metadata) return invalid(); metadata=true; walk(data+4,next,depth+1); }
			if (type==='iprp' || type==='ipco') walk(data,next,depth+1);
			if (type==='ispe') {
				if (size!==20) return invalid();
				const w=v.getUint32(data+4),h=v.getUint32(data+8); checkDimensions(w,h,bytes.length);
				if (width && (width!==w || height!==h)) throw new Error('AVIF grids or unequal auxiliary image dimensions are not supported.');
				width=w; height=h;
			}
			if (type==='av1C') { if (size<12) return invalid(); if (bytes[data+2]&0x60) throw new Error('10/12-bit and HDR AVIF are not supported; use an 8-bit still image.'); config=true; }
			if (type==='mdat') payload=true;
			p=next;
		}
	}
	walk(0,bytes.length,0);
	if (!metadata || !payload || !config || !width || !height) return invalid();
	return {width,height};
}
