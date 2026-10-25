import { checkDimensions } from '../image-format.ts';

// Read the JPEG XL codestream size header before loading the WASM decoder.
// This rejects oversized images before their pixel buffers can be allocated.
function codestream(bytes: Uint8Array): Uint8Array {
	if (bytes[0] === 0xff && bytes[1] === 0x0a) return bytes;
	const signature = [0,0,0,12,74,88,76,32,13,10,135,10];
	if (signature.some((value,i) => bytes[i] !== value)) throw new Error('Invalid JPEG XL signature.');
	let payload: Uint8Array | undefined;
	for (let p=12, count=0; p<bytes.length;) {
		if (++count>128 || p+8>bytes.length) throw new Error('Corrupt JPEG XL container.');
		const v=new DataView(bytes.buffer,bytes.byteOffset+p,8),size=v.getUint32(0),type=String.fromCharCode(...bytes.subarray(p+4,p+8));
		if (size<8 || p+size>bytes.length) throw new Error('Unsupported JPEG XL container box.');
		if (type==='jxlp') throw new Error('Segmented JPEG XL codestreams are not supported yet.');
		if (type==='jxlc') {
			if (payload) throw new Error('Multiple JPEG XL codestreams are not supported.');
			payload=bytes.subarray(p+8,p+size);
		}
		p+=size;
	}
	if (!payload || payload[0]!==0xff || payload[1]!==0x0a) throw new Error('JPEG XL image codestream is missing.');
	return payload;
}
export function jxlInfo(bytes:Uint8Array) {
	const data=codestream(bytes);
	let pos=16;
	const bits=(count:number):number=>{
		if (pos+count>data.length*8) throw new Error('Truncated JPEG XL image header.');
		let value=0;
		for(let i=0;i<count;i++,pos++) value+=(data[pos>>>3]>>> (pos&7)&1)*2**i;
		return value;
	};
	const u32=()=>{
		const choice=bits(2);
		return bits([9,13,18,30][choice]);
	};
	const size=():{width:number;height:number}=>{
		const small=bits(1);
		const height=small?(bits(5)+1)*8:u32()+1;
		const ratio=bits(3);
		const factors:[number,number][]=[[0,1],[1,1],[12,10],[4,3],[3,2],[16,9],[5,4],[2,1]];
		const width=ratio?Math.floor(height*factors[ratio][0]/factors[ratio][1]):small?(bits(5)+1)*8:u32()+1;
		return {width,height};
	};
	const {width,height}=size();
	checkDimensions(width,height,bytes.length);
	const defaults=bits(1);
	if (!defaults && bits(1)) {
		if (bits(3)!==0) throw new Error('JPEG XL orientation metadata is not supported yet.');
		if(bits(1))size();
		if(bits(1)) throw new Error('JPEG XL preview frames are not supported yet.');
		if(bits(1)) throw new Error('Animated JPEG XL is not supported yet.');
	}
	return {width,height};
}
export async function decodeJxl(bytes:Uint8Array) {
	const {width,height}=jxlInfo(bytes);
	const {default:decode}=await import('@jsquash/jxl/decode.js');
	const result=await decode(bytes.slice().buffer);
	if(result.width!==width || result.height!==height || result.data.length!==width*height*4)
		throw new Error('JPEG XL decoded dimensions do not match its header.');
	return result;
}
