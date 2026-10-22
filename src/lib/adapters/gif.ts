import { ascii } from '../formats.ts';
export function gifInfo(b:Uint8Array) {
	const fail=():never=>{throw new Error('Corrupt or unsupported GIF structure.');};
	const animated=():never=>{throw new Error('Animated GIF is not supported. Choose a still image.');};
	if(b.length<14||!['GIF87a','GIF89a'].includes(ascii(b,0,6))) return fail();
	const v=new DataView(b.buffer,b.byteOffset,b.length),width=v.getUint16(6,true),height=v.getUint16(8,true);
	const global=!!(b[10]&128); let p=13+(global?3*2**((b[10]&7)+1):0),frames=0;
	const blocks=()=>{ let total=0; for(;;) { if(p>=b.length) fail(); const n=b[p++]; if(!n) return total; if(p+n>b.length) fail(); total+=n; p+=n; } };
	while(p<b.length) {
		const marker=b[p++];
		if(marker===0x3b) { if(p!==b.length||frames!==1) return fail(); return {width,height}; }
		if(marker===0x21) {
			const type=b[p++];
			if(type===0xf9) { if(p+6>b.length||b[p]!==4||b[p+5]!==0||(b[p+1]&0xe0)||((b[p+1]>>2)&7)>3) return fail(); p+=6; }
			else if(type===0xff) {
				if(b[p++]!==11||p+11>b.length) return fail();
				if(['NETSCAPE2.0','ANIMEXTS1.0'].includes(ascii(b,p,11))) return animated(); p+=11; blocks();
			} else if(type===0xfe) blocks(); else return fail();
		} else if(marker===0x2c) {
			if(++frames>1) return animated(); if(p+9>b.length) return fail();
			const x=v.getUint16(p,true),y=v.getUint16(p+2,true),w=v.getUint16(p+4,true),h=v.getUint16(p+6,true),packed=b[p+8]; p+=9;
			if(!w||!h||x+w>width||y+h>height||(packed&24)) return fail();
			if(packed&128) p+=3*2**((packed&7)+1); else if(!global) return fail();
			if(p>=b.length||b[p]<2||b[p]>8) return fail(); p++;
			if(!blocks()) return fail();
		} else return fail();
	}
	return fail();
}
