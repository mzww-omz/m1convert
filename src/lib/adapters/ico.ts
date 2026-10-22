import { checkDimensions } from '../image-format.ts';

export interface IconFrame { width: number; height: number; offset: number; length: number }
const invalid = (): never => { throw new Error('ICO has a corrupt directory, dimensions or image payload.'); };
export function icoFrames(bytes: Uint8Array): IconFrame[] {
	if (bytes.length < 6) return invalid();
	const v = new DataView(bytes.buffer,bytes.byteOffset,bytes.length), count = v.getUint16(4,true);
	if (v.getUint32(0,true) !== 0x10000 || count < 1 || count > 64 || 6 + count * 16 > bytes.length) return invalid();
	const frames: IconFrame[] = [];
	for (let i = 0; i < count; i++) {
		const p = 6+i*16, width = bytes[p] || 256, height = bytes[p+1] || 256;
		const length = v.getUint32(p+8,true), offset = v.getUint32(p+12,true);
		if (bytes[p+3] !== 0 || offset < 6+count*16 || length < 40 || offset+length > bytes.length || frames.some(f => offset < f.offset+f.length && f.offset < offset+length)) return invalid();
		checkDimensions(width,height,bytes.length);
		frames.push({width,height,offset,length});
	}
	if (Math.max(...frames.map(f => f.offset+f.length)) !== bytes.length) return invalid();
	return frames;
}
export function encodeIco(frames: { width: number; height: number; bytes: Uint8Array }[]): Uint8Array<ArrayBuffer> {
	if (!frames.length || frames.length > 64 || frames.some(f => !Number.isInteger(f.width) || !Number.isInteger(f.height) || f.width < 1 || f.height < 1 || f.width > 256 || f.height > 256)) return invalid();
	const bytes = new Uint8Array(6+16*frames.length+frames.reduce((n,f) => n+f.bytes.length,0)), v = new DataView(bytes.buffer);
	v.setUint16(2,1,true); v.setUint16(4,frames.length,true);
	let offset = 6+16*frames.length;
	frames.forEach((f,i) => {
		const p = 6+i*16;
		bytes[p] = f.width % 256; bytes[p+1] = f.height % 256;
		v.setUint16(p+4,1,true); v.setUint16(p+6,32,true); v.setUint32(p+8,f.bytes.length,true); v.setUint32(p+12,offset,true);
		bytes.set(f.bytes,offset); offset += f.bytes.length;
	});
	return bytes;
}

export function decodeIconDib(bytes: Uint8Array, frame: IconFrame) {
	const v = new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
	if (bytes.length < 40 || v.getUint32(0,true) !== 40 || v.getInt32(4,true) !== frame.width || v.getInt32(8,true) !== frame.height*2 || v.getUint16(12,true) !== 1 || v.getUint32(16,true) !== 0) return invalid();
	const bits = v.getUint16(14,true), { width, height } = frame;
	if (bits !== 24 && bits !== 32) throw new Error('ICO DIB supports only uncompressed 24/32-bit frames or PNG frames.');
	const stride = Math.ceil(width*bits/32)*4, maskStride = Math.ceil(width/32)*4;
	if (bytes.length !== 40+height*(stride+maskStride)) return invalid();
	const data = new Uint8ClampedArray(width*height*4);
	let hasAlpha = false;
	if (bits === 32) for (let y=0;y<height;y++) for (let x=0;x<width;x++) hasAlpha ||= bytes[40+y*stride+x*4+3] !== 0;
	for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
		const row = height-1-y, p=40+row*stride+x*bits/8, d=(y*width+x)*4;
		const masked = bytes[40+height*stride+row*maskStride+(x>>3)] & (128>>(x%8));
		data.set([bytes[p+2],bytes[p+1],bytes[p], masked ? 0 : hasAlpha ? bytes[p+3] : 255],d);
	}
	return { width,height,data };
}
