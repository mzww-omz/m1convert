import {checkDimensions} from '../image-format.ts';
export type PnmFormat='PBM'|'PGM'|'PPM';
export interface Rgba {width:number;height:number;data:Uint8ClampedArray}
function fail():never {throw new Error('Netpbm image is corrupt, truncated or uses unsupported pixel values.');}
const SPACE=(b:number)=>b===9||b===10||b===11||b===12||b===13||b===32;

export function pnmInfo(bytes:Uint8Array) {
	if(bytes.length<4||bytes[0]!==80||bytes[1]<49||bytes[1]>54)return fail();
	const variant=bytes[1]-48,format: PnmFormat=[1,4].includes(variant)?'PBM':[2,5].includes(variant)?'PGM':'PPM';
	let pos=2;
	const skip=()=>{
		for(;;) {
			while(pos<bytes.length&&SPACE(bytes[pos]))pos++;
			if(bytes[pos]===35){while(pos<bytes.length&&bytes[pos]!==10&&bytes[pos]!==13)pos++;continue;}
			return;
		}
	};
	const token=()=>{
		skip();const start=pos;
		while(pos<bytes.length&&!SPACE(bytes[pos])&&bytes[pos]!==35)pos++;
		if(start===pos||pos-start>16)return fail();
		for(let i=start;i<pos;i++)if(bytes[i]<48||bytes[i]>57)return fail();
		const n=Number(new TextDecoder().decode(bytes.subarray(start,pos)));
		if(!Number.isSafeInteger(n))return fail();
		return n;
	};
	const width=token(),height=token(),max=[1,4].includes(variant)?1:token();
	if(max<1||max>65535)return fail();
	checkDimensions(width,height,bytes.length);
	let start=pos;
	if(variant>=4){
		if(!SPACE(bytes[start]))return fail();
		start++;
		if(bytes[start-1]===13&&bytes[start]===10)start++;
		const channels=format==='PPM'?3:1,size=variant===4?Math.ceil(width/8)*height:width*height*channels*(max>255?2:1);
		if(start+size!==bytes.length)return fail();
	} else {
		skip();start=pos;
		let count=0;
		while(pos<bytes.length) {
			const value=token();if(value>max)return fail();count++;
			skip();
			if(count>width*height*(format==='PPM'?3:1))return fail();
		}
		if(count!==width*height*(format==='PPM'?3:1))return fail();
	}
	return {width,height,format,variant,max,start};
}

export function decodePnm(bytes:Uint8Array):Rgba {
	const info=pnmInfo(bytes),{width,height,format,variant,max,start}=info;
	const data=new Uint8ClampedArray(width*height*4);
	let pos=start;
	const read=()=>{
		while(pos<bytes.length&&(SPACE(bytes[pos])||bytes[pos]===35)) {
			if(bytes[pos]===35){while(pos<bytes.length&&bytes[pos]!==10&&bytes[pos]!==13)pos++;}
			else pos++;
		}
		const p=pos;while(pos<bytes.length&&!SPACE(bytes[pos])&&bytes[pos]!==35)pos++;
		return Number(new TextDecoder().decode(bytes.subarray(p,pos)));
	};
	for(let i=0;i<width*height;i++){
		const vals:number[]=[];
		const channels=format==='PPM'?3:1;
		if(variant===4)vals.push((bytes[start+Math.floor(i/width)*Math.ceil(width/8)+Math.floor((i%width)/8)]>>(7-i%8))&1);
		else for(let c=0;c<channels;c++){
			if(variant<=3)vals.push(read());
			else if(max>255){vals.push(bytes[pos]*256+bytes[pos+1]);pos+=2;}
			else vals.push(bytes[pos++]);
		}
		let rgb:number[];
		if(format==='PBM'){const v=vals[0]?0:255;rgb=[v,v,v];}
		else if(format==='PGM'){const v=Math.round(vals[0]*255/max);rgb=[v,v,v];}
		else rgb=vals.map(v=>Math.round(v*255/max));
		const p=i*4;data[p]=rgb[0];data[p+1]=rgb[1];data[p+2]=rgb[2];data[p+3]=255;
	}
	return {width,height,data};
}

export function encodePnm(image:Rgba,format:PnmFormat):Uint8Array<ArrayBuffer> {
	const {width,height,data}=image;checkDimensions(width,height,0);
	if(data.length!==width*height*4)return fail();
	const variant=format==='PBM'?4:format==='PGM'?5:6;
	const stride=format==='PBM'?Math.ceil(width/8):width*(format==='PPM'?3:1);
	const header=new TextEncoder().encode(`P${variant}\n${width} ${height}\n${format==='PBM'?'':'255\n'}`);
	const result=new Uint8Array(header.length+stride*height);result.set(header);
	for(let y=0;y<height;y++)for(let x=0;x<width;x++){
		const p=(y*width+x)*4,a=data[p+3]/255;
		const r=data[p]*a+255*(1-a),g=data[p+1]*a+255*(1-a),b=data[p+2]*a+255*(1-a);
		const o=header.length+y*stride;
		if(format==='PPM')result.set([Math.round(r),Math.round(g),Math.round(b)],o+x*3);
		else {
			const gray=Math.round(.2126*r+.7152*g+.0722*b);
			if(format==='PGM')result[o+x]=gray;
			else if(gray<128)result[o+Math.floor(x/8)]|=1<<(7-x%8);
		}
	}
	return result;
}
