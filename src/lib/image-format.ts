import { ascii } from './formats.ts';
import { detectFormat } from './registry.ts';

export const LIMITS = {
	maxFileBytes: 64 * 1024 ** 2,
	maxWorkingBytes: 256 * 1024 ** 2,
	maxOutputBytes: 64 * 1024 ** 2
} as const;

export interface ImageInfo {
	format: string;
	mime: string;
	encodedWidth: number;
	encodedHeight: number;
	width: number;
	height: number;
	orientation: number;
	frames?: { width: number; height: number }[];
	frame?: number;
}

function corrupt(): never { throw new Error('The image is corrupt or truncated. Choose another file.'); }
function animated(): never { throw new Error('Animated images are not supported yet. Choose a still image.'); }

export function checkDimensions(width: number, height: number, encodedBytes: number) {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !Number.isSafeInteger(encodedBytes) || encodedBytes < 0)
		throw new Error('Invalid image dimensions or encoded size.');
	// Budget decoded pixels, canvas/verification copies and encoded input before allocation.
	if (width * height * 12 + encodedBytes * 2 > LIMITS.maxWorkingBytes) throw new Error('Safety limit: image exceeds the 256 MiB working memory budget. Resize or use a smaller source image.');
}

// Read only the orientation tag; never trust TIFF offsets or entry counts.
function exifOrientation(bytes: Uint8Array): number {
	const start = ascii(bytes, 0, 6) === 'Exif\0\0' ? 6 : 0;
	const view = new DataView(bytes.buffer, bytes.byteOffset + start, bytes.length - start);
	if (view.byteLength < 8) return corrupt();
	const order = view.getUint16(0);
	if (order !== 0x4949 && order !== 0x4d4d) return corrupt();
	const little = order === 0x4949;
	if (view.getUint16(2, little) !== 42) return corrupt();
	const offset = view.getUint32(4, little);
	if (offset < 8 || offset + 2 > view.byteLength) return corrupt();
	const entries = view.getUint16(offset, little);
	if (offset + 2 + entries * 12 + 4 > view.byteLength) return corrupt();
	for (let i = 0; i < entries; i++) {
		const p = offset + 2 + i * 12;
		if (view.getUint16(p, little) !== 0x0112) continue;
		if (view.getUint16(p + 2, little) !== 3 || view.getUint32(p + 4, little) !== 1) return corrupt();
		const orientation = view.getUint16(p + 8, little);
		if (orientation < 1 || orientation > 8) return corrupt();
		return orientation;
	}
	return 1;
}

function pngInfo(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	if (bytes.length < 33 || view.getUint32(8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') return corrupt();
	const width = view.getUint32(16), height = view.getUint32(20);
	let imageData = false, ended = false, orientation = 1;
	for (let p = 8; p < bytes.length;) {
		if (p + 12 > bytes.length) return corrupt();
		const length = view.getUint32(p), type = ascii(bytes, p + 4, 4);
		const end = p + 12 + length;
		if (end > bytes.length) return corrupt();
		if (type === 'acTL') animated();
		if (type === 'eXIf') orientation = exifOrientation(bytes.subarray(p + 8, p + 8 + length));
		if (type === 'IDAT') imageData = true;
		if (type === 'IEND') {
			if (length !== 0 || end !== bytes.length) return corrupt();
			ended = true;
			break;
		}
		p = end;
	}
	if (!imageData || !ended) return corrupt();
	return { width, height, orientation };
}

function jpegInfo(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	if (bytes.length < 4 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return corrupt();
	let width = 0, height = 0, orientation = 1;
	for (let p = 2; p < bytes.length - 2;) {
		if (bytes[p++] !== 255) return corrupt();
		while (bytes[p] === 255) p++;
		const marker = bytes[p++];
		if (marker === 0xda) break;
		if (marker === 0xd9 || marker === undefined || marker === 0x00) return corrupt();
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		if (p + 2 > bytes.length) return corrupt();
		const length = view.getUint16(p);
		if (length < 2 || p + length > bytes.length) return corrupt();
		if (marker === 0xe1 && ascii(bytes, p + 2, 6) === 'Exif\0\0') orientation = exifOrientation(bytes.subarray(p + 2, p + length));
		if ([0xc0, 0xc1, 0xc2].includes(marker)) {
			if (length < 8 || width) return corrupt();
			height = view.getUint16(p + 3); width = view.getUint16(p + 5);
		}
		p += length;
	}
	if (!width || !height) return corrupt();
	return { width, height, orientation };
}

function webpInfo(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length) return corrupt();
	const u24 = (p: number) => bytes[p] | bytes[p + 1] << 8 | bytes[p + 2] << 16;
	let width = 0, height = 0, canvasWidth = 0, canvasHeight = 0, orientation = 1;
	for (let p = 12; p < bytes.length;) {
		if (p + 8 > bytes.length) return corrupt();
		const type = ascii(bytes, p, 4), length = view.getUint32(p + 4, true), data = p + 8;
		const end = data + length + (length % 2);
		if (end > bytes.length) return corrupt();
		if (type === 'ANIM' || type === 'ANMF') animated();
		if (type === 'VP8X') {
			if (length !== 10 || canvasWidth) return corrupt();
			if (bytes[data] & 2) animated();
			canvasWidth = u24(data + 4) + 1; canvasHeight = u24(data + 7) + 1;
		}
		if (type === 'VP8 ') {
			if (length < 10 || width || ascii(bytes, data + 3, 3) !== '\x9d\x01\x2a') return corrupt();
			width = view.getUint16(data + 6, true) & 0x3fff; height = view.getUint16(data + 8, true) & 0x3fff;
		}
		if (type === 'VP8L') {
			if (length < 5 || width || bytes[data] !== 0x2f) return corrupt();
			const bits = view.getUint32(data + 1, true);
			if (bits >>> 29) return corrupt();
			width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
		}
		if (type === 'EXIF') orientation = exifOrientation(bytes.subarray(data, data + length));
		p = end;
	}
	if (!width || !height || (canvasWidth && (width !== canvasWidth || height !== canvasHeight))) return corrupt();
	return { width, height, orientation };
}

export async function inspectFile(file:File,output=false):Promise<ImageInfo> {
	return (await readImage(file,output)).info;
}
export async function readImage(file: File, output = false): Promise<{info:ImageInfo;bytes:Uint8Array<ArrayBuffer>}> {
	if (!file.size) throw new Error('The file is empty. Choose a PNG, JPEG or WebP image.');
	if (file.size > (output ? LIMITS.maxOutputBytes : LIMITS.maxFileBytes)) throw new Error('Safety limit: encoded image exceeds the 64 MiB buffer budget. Use a smaller source.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const format = detectFormat(bytes);
	if (!format || !format.mime.startsWith('image/')) throw new Error('This file is not supported. Choose a supported still image.');
	let raw: { width: number; height: number; orientation: number; frames?: {width:number;height:number}[]; frame?:number };
	if (format.id === 'PNG') raw = pngInfo(bytes);
	else if (format.id === 'JPEG') raw = jpegInfo(bytes);
	else if (format.id === 'WEBP') raw = webpInfo(bytes);
	else if (format.id === 'GIF') raw = { ...(await import('./adapters/gif.ts')).gifInfo(bytes), orientation:1 };
	else if (format.id === 'TIFF') raw = { ...(await import('./adapters/tiff.ts')).tiffInfo(bytes), orientation:1 };
	else if (format.id === 'BMP') raw = { ...(await import('./adapters/bmp.ts')).bmpInfo(bytes), orientation: 1 };
	else if (format.id === 'AVIF') raw = { ...(await import('./adapters/avif.ts')).avifInfo(bytes), orientation: 1 };
	else if (format.id === 'SVG') raw = { ...(await import('./adapters/svg.ts')).svgInfo(bytes), orientation: 1 };
	else {
		const { icoFrames, decodeIconDib } = await import('./adapters/ico.ts');
		const frames = icoFrames(bytes);
		for (const frame of frames) {
			const payload = bytes.subarray(frame.offset, frame.offset+frame.length);
			if (detectFormat(payload)?.id === 'PNG') {
				const png = pngInfo(payload);
				if (png.width !== frame.width || png.height !== frame.height || png.orientation !== 1) throw new Error('ICO frame dimensions do not match its directory.');
			} else decodeIconDib(payload,frame);
		}
		const frame = frames.reduce((best,f,i) => f.width*f.height > frames[best].width*frames[best].height ? i : best,0);
		raw = { ...frames[frame], frames: frames.map(({width,height}) => ({width,height})), frame, orientation:1 };
	}
	checkDimensions(raw.width, raw.height, file.size);
	return {bytes,info:{
		format: format.id, mime: format.mime, encodedWidth: raw.width, encodedHeight: raw.height,
		width: raw.orientation >= 5 ? raw.height : raw.width,
		height: raw.orientation >= 5 ? raw.width : raw.height,
		orientation: raw.orientation, ...(raw.frames ? { frames:raw.frames, frame:raw.frame } : {})
	}};
}

export class OutputVerificationError extends Error {}
export async function verifyOutput(blob: Blob, formatId: string): Promise<void> {
	if (!blob.size) throw new OutputVerificationError('The image encoder returned an empty output. Try another format.');
	if (blob.size > LIMITS.maxOutputBytes) throw new Error('Safety limit: image encoder output exceeds the 64 MiB buffer budget. Try PNG, a lower quality, or a smaller source image.');
	const format = detectFormat(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()));
	if (format?.id !== formatId || blob.type !== format.mime)
		throw new OutputVerificationError(`The browser could not encode ${formatId}: output contents or MIME do not match. Try another format.`);
}
