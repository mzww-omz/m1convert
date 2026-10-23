import { checkDimensions, LIMITS } from '../image-format.ts';
interface Rgba {width:number;height:number;data:Uint8ClampedArray}
function packBits(source:Uint8Array,size:number,rowBytes:number,target?:Uint8Array) {
	let p=0,written=0;
	while(p<source.length) {
		const code=source[p++];if(code===128)continue;
		const count=code<128?code+1:257-code;
		if(count>size-written||count>rowBytes-written%rowBytes||p+(code<128?count:1)>source.length)throw new Error('Corrupt TIFF PackBits run.');
		if(code<128) {target?.set(source.subarray(p,p+count),written);p+=count;}
		else {target?.fill(source[p],written,written+count);p++;}
		written+=count;
	}
	if(written!==size)throw new Error('Truncated TIFF PackBits strip.');
}
function parse(b:Uint8Array) {
	const fail=():never=>{throw new Error('Corrupt or unsupported TIFF: use single-page unsigned 8/16-bit grayscale or RGB/RGBA, uncompressed or PackBits, orientation 1.');};
	if(b.length<8) return fail(); const v=new DataView(b.buffer,b.byteOffset,b.length),order=v.getUint16(0),little=order===0x4949;
	if((!little&&order!==0x4d4d)||v.getUint16(2,little)!==42) return fail();
	const offset=v.getUint32(4,little); if(offset<8||offset+2>b.length) return fail();
	const count=v.getUint16(offset,little); if(count<1||count>128||offset+2+count*12+4>b.length||v.getUint32(offset+2+count*12,little)) return fail();
	const tags=new Map<number,number[]>(), ranges:{start:number;end:number}[]=[{start:0,end:8},{start:offset,end:offset+2+count*12+4}];
	const sizes:Record<number,number>={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8};
	const needed=[256,257,258,259,262,273,274,277,278,279,284,338,339];
	for(let i=0,p=offset+2;i<count;i++,p+=12) {
		const tag=v.getUint16(p,little),type=v.getUint16(p+2,little),n=v.getUint32(p+4,little),size=sizes[type];
		if(tag===34675 || tag===301) throw new Error('TIFF ICC profiles and transfer functions are not supported. Use an sRGB TIFF without a profile.');
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
	const width=single(256),height=single(257),channels=single(277,1),rows=single(278,height),bits=tags.get(258),compression=single(259,1),photo=single(262),depth=bits?.[0];
	checkDimensions(width,height,b.length);
	if(![1,32773].includes(compression)||!(photo===2?[3,4].includes(channels):[0,1].includes(photo)&&channels===1)||!bits||bits.length!==channels||![8,16].includes(depth!)||bits.some(v=>v!==depth)||single(274,1)!==1||single(284,1)!==1||!rows||
		(tags.has(339)&&tags.get(339)!.some(v=>v!==1)) || (channels===4&&(tags.get(338)?.length!==1||single(338)!==2)) || (channels!==4&&tags.has(338))) return fail();
	// Include the largest unpacked strip in addition to Canvas/verification copies.
	if(width*height*20+b.length*2>LIMITS.maxWorkingBytes)throw new Error('Safety limit: TIFF exceeds the 256 MiB working memory budget.');
	const offsets=tags.get(273),lengths=tags.get(279),strips=Math.ceil(height/rows);
	if(!offsets||!lengths||offsets.length!==strips||lengths.length!==strips) return fail();
	for(let i=0;i<strips;i++) {
		const size=Math.min(rows,height-i*rows)*width*channels*depth!/8;
		if(!lengths[i]||offsets[i]<8||offsets[i]+lengths[i]>b.length) return fail();
		if(compression===1) {if(lengths[i]!==size)return fail();}
		else packBits(b.subarray(offsets[i],offsets[i]+lengths[i]),size,width*channels*depth!/8);
		ranges.push({start:offsets[i],end:offsets[i]+lengths[i]});
	}
	ranges.sort((a,b)=>a.start-b.start); for(let i=1;i<ranges.length;i++) if(ranges[i].start<ranges[i-1].end) return fail();
	return {width,height,channels,offsets,lengths,depth:depth!,compression,photo,little,rows};
}
export function tiffInfo(b:Uint8Array) { const {width,height}=parse(b); return {width,height}; }
export function decodeTiff(b:Uint8Array):Rgba {
	const {width,height,channels,offsets,lengths,depth,compression,photo,little,rows}=parse(b),data=new Uint8ClampedArray(width*height*4); let p=0;
	for(let i=0;i<offsets.length;i++) {
		const encoded=b.subarray(offsets[i],offsets[i]+lengths[i]),size=Math.min(rows,height-i*rows)*width*channels*depth/8;
		const strip=compression===1?encoded:new Uint8Array(size);
		if(compression!==1)packBits(encoded,size,width*channels*depth/8,strip);
		const view=new DataView(strip.buffer,strip.byteOffset,strip.length),step=depth/8;
		const sample=(j:number)=>depth===8?strip[j]:Math.round(view.getUint16(j,little)/257);
		for(let j=0;j<strip.length;j+=channels*step) {
			if(channels===1) {const gray=photo===0?255-sample(j):sample(j);data[p++]=gray;data[p++]=gray;data[p++]=gray;}
			else {data[p++]=sample(j);data[p++]=sample(j+step);data[p++]=sample(j+2*step);}
			data[p++]=channels===4?sample(j+3*step):255;
		}
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
