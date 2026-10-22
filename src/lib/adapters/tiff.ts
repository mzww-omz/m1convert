import { checkDimensions } from '../image-format.ts';
interface Rgba {width:number;height:number;data:Uint8ClampedArray}
function parse(b:Uint8Array) {
	const fail=():never=>{throw new Error('Corrupt or unsupported TIFF: use single-page uncompressed 8-bit RGB/RGBA with orientation 1.');};
	if(b.length<8) return fail(); const v=new DataView(b.buffer,b.byteOffset,b.length),order=v.getUint16(0),little=order===0x4949;
	if((!little&&order!==0x4d4d)||v.getUint16(2,little)!==42) return fail();
	const offset=v.getUint32(4,little); if(offset<8||offset+2>b.length) return fail();
	const count=v.getUint16(offset,little); if(count<1||count>128||offset+2+count*12+4>b.length||v.getUint32(offset+2+count*12,little)) return fail();
	const tags=new Map<number,number[]>(), ranges:{start:number;end:number}[]=[{start:0,end:8},{start:offset,end:offset+2+count*12+4}];
	const sizes:Record<number,number>={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8};
	const needed=[256,257,258,259,262,273,274,277,278,279,284,338,339];
	for(let i=0,p=offset+2;i<count;i++,p+=12) {
		const tag=v.getUint16(p,little),type=v.getUint16(p+2,little),n=v.getUint32(p+4,little),size=sizes[type];
		if(!size||!n||n>4*1024**2||tags.has(tag)) return fail();
		const length=n*size,start=length<=4?p+8:v.getUint32(p+8,little);
		if(start+length>b.length || (length>4&&start<8)) return fail();
		if(length>4) ranges.push({start,end:start+length});
		if(needed.includes(tag)) {
			if(![3,4].includes(type)||n>8192) return fail();
			tags.set(tag,Array.from({length:n},(_,j)=>type===3?v.getUint16(start+j*2,little):v.getUint32(start+j*4,little)));
		} else tags.set(tag,[]);
	}
	const single=(tag:number,fallback=0)=> { const a=tags.get(tag); if(!a) return fallback; if(a.length!==1) return fail(); return a[0]; };
	const width=single(256),height=single(257),channels=single(277,1),rows=single(278,height),bits=tags.get(258);
	checkDimensions(width,height,b.length);
	if(single(259,1)!==1||single(262)!==2||![3,4].includes(channels)||!bits||bits.length!==channels||bits.some(v=>v!==8)||single(274,1)!==1||single(284,1)!==1||!rows||
		(tags.has(339)&&tags.get(339)!.some(v=>v!==1)) || (channels===4&&(tags.get(338)?.length!==1||single(338)!==2)) || (channels===3&&tags.has(338))) return fail();
	const offsets=tags.get(273),lengths=tags.get(279),strips=Math.ceil(height/rows);
	if(!offsets||!lengths||offsets.length!==strips||lengths.length!==strips) return fail();
	for(let i=0;i<strips;i++) {
		const size=Math.min(rows,height-i*rows)*width*channels;
		if(lengths[i]!==size||offsets[i]<8||offsets[i]+size>b.length) return fail();
		ranges.push({start:offsets[i],end:offsets[i]+size});
	}
	ranges.sort((a,b)=>a.start-b.start); for(let i=1;i<ranges.length;i++) if(ranges[i].start<ranges[i-1].end) return fail();
	return {width,height,channels,offsets,lengths};
}
export function tiffInfo(b:Uint8Array) { const {width,height}=parse(b); return {width,height}; }
export function decodeTiff(b:Uint8Array):Rgba {
	const {width,height,channels,offsets,lengths}=parse(b),data=new Uint8ClampedArray(width*height*4); let p=0;
	for(let i=0;i<offsets.length;i++) for(let j=offsets[i];j<offsets[i]+lengths[i];j+=channels) {
		data[p++]=b[j];data[p++]=b[j+1];data[p++]=b[j+2];data[p++]=channels===4?b[j+3]:255;
	}
	return {width,height,data};
}
export function encodeTiff(image:Rgba):Uint8Array<ArrayBuffer> {
	checkDimensions(image.width,image.height,0);
	if(image.data.length!==image.width*image.height*4) throw new Error('Invalid TIFF pixel data.');
	const count=13,bits=8+2+count*12+4,pixels=bits+8,b=new Uint8Array(pixels+image.data.length),v=new DataView(b.buffer);
	b.set([73,73,42,0]); v.setUint32(4,8,true);v.setUint16(8,count,true);
	const tags=[[256,4,1,image.width],[257,4,1,image.height],[258,3,4,bits],[259,3,1,1],[262,3,1,2],[273,4,1,pixels],[274,3,1,1],[277,3,1,4],[278,4,1,image.height],[279,4,1,image.data.length],[284,3,1,1],[338,3,1,2],[339,3,1,1]];
	for(let i=0;i<count;i++) {
		const [tag,type,n,value]=tags[i],p=10+i*12;v.setUint16(p,tag,true);v.setUint16(p+2,type,true);v.setUint32(p+4,n,true);
		if(type===3&&n===1) v.setUint16(p+8,value,true); else v.setUint32(p+8,value,true);
	}
	for(let i=0;i<4;i++) v.setUint16(bits+i*2,8,true);b.set(image.data,pixels); return b;
}
