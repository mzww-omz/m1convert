import { checkDimensions } from '../image-format.ts';

export interface Rgba { width: number; height: number; data: Uint8ClampedArray }
const invalid = (): never => { throw new Error('BMP is corrupt or truncated.'); };

export function bmpInfo(bytes: Uint8Array) {
	if (bytes.length < 54 || bytes[0] !== 66 || bytes[1] !== 77) return invalid();
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	const header = v.getUint32(14, true), offset = v.getUint32(10, true);
	if (![40, 108, 124].includes(header) || 14 + header > bytes.length || offset < 14 + header || v.getUint32(2, true) !== bytes.length) return invalid();
	const width = v.getInt32(18, true), signedHeight = v.getInt32(22, true), height = Math.abs(signedHeight);
	checkDimensions(width, height, bytes.length);
	const bits = v.getUint16(28, true), compression = v.getUint32(30, true);
	if (v.getUint16(26, true) !== 1) return invalid();
	if (bits !== 24 && bits !== 32) throw new Error('BMP supports only 24-bit and 32-bit pixels.');
	// V4/V5 BI_BITFIELDS is accepted only for the standard RGBA masks we emit.
	if (compression !== 0 && !(compression === 3 && header >= 108 && bits === 32 &&
		v.getUint32(54,true) === 0xff0000 && v.getUint32(58,true) === 0xff00 && v.getUint32(62,true) === 0xff && v.getUint32(66,true) === 0xff000000))
		throw new Error('Unsupported BMP compression or channel masks.');
	const stride = Math.ceil(width * bits / 32) * 4;
	if (offset + stride * height !== bytes.length) return invalid();
	return { width, height, offset, stride, bits, topDown: signedHeight < 0, alpha: compression === 3 };
}

export function decodeBmp(bytes: Uint8Array): Rgba {
	const info = bmpInfo(bytes), { width, height, offset, stride, bits, topDown } = info;
	const data = new Uint8ClampedArray(width * height * 4);
	// BI_RGB's fourth byte is reserved, not a reliable alpha channel.
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const p = offset + (topDown ? y : height - 1 - y) * stride + x * bits / 8, d = (y * width + x) * 4;
		data[d] = bytes[p + 2]; data[d + 1] = bytes[p + 1]; data[d + 2] = bytes[p]; data[d + 3] = info.alpha ? bytes[p + 3] : 255;
	}
	return { width, height, data };
}

export function encodeBmp({ width, height, data }: Rgba): Uint8Array<ArrayBuffer> {
	checkDimensions(width, height, 0);
	if (data.length !== width * height * 4) throw new Error('Invalid RGBA buffer.');
	// BITMAPV4HEADER with explicit alpha masks avoids ambiguous BI_RGB alpha.
	const bytes = new Uint8Array(122 + data.length), v = new DataView(bytes.buffer);
	bytes.set([66,77]); v.setUint32(2,bytes.length,true); v.setUint32(10,122,true); v.setUint32(14,108,true);
	v.setInt32(18,width,true); v.setInt32(22,-height,true); v.setUint16(26,1,true); v.setUint16(28,32,true);
	v.setUint32(30,3,true); v.setUint32(34,data.length,true);
	for (const [p, mask] of [[54,0xff0000],[58,0xff00],[62,0xff],[66,0xff000000],[70,0x73524742]]) v.setUint32(p,mask,true);
	for (let p = 0; p < data.length; p += 4) bytes.set([data[p+2],data[p+1],data[p],data[p+3]],122+p);
	return bytes;
}
