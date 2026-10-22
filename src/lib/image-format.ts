import { ascii } from './formats.ts';
import { detectFormat } from './registry.ts';

export const LIMITS = {
	maxFileBytes: 32 * 1024 ** 2,
	maxPixels: 16_000_000,
	maxDimension: 8192,
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
}

function corrupt(): never { throw new Error('The image is corrupt or truncated. Choose another file.'); }
function animated(): never { throw new Error('Animated images are not supported yet. Choose a still PNG, JPEG or WebP.'); }

export function checkDimensions(width: number, height: number, encodedBytes: number) {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > LIMITS.maxDimension || height > LIMITS.maxDimension)
		throw new Error('Image dimensions must be between 1 and 8192 pixels per side.');
	if (width * height > LIMITS.maxPixels) throw new Error('Image exceeds the 16 million pixels limit.');
	if (width * height * 12 + encodedBytes * 2 > LIMITS.maxWorkingBytes) throw new Error('Image exceeds the 256 MiB working memory budget.');
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
	if (entries > 512 || offset + 2 + entries * 12 + 4 > view.byteLength) return corrupt();
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

export async function inspectFile(file: File): Promise<ImageInfo> {
	if (!file.size) throw new Error('The file is empty. Choose a PNG, JPEG or WebP image.');
	if (file.size > LIMITS.maxFileBytes) throw new Error('File exceeds the 32 MiB limit.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const format = detectFormat(bytes);
	if (!format) throw new Error('This file is not supported. Choose a PNG, JPEG or WebP image.');
	if (file.type && file.type !== 'application/octet-stream' && file.type !== format.mime)
		throw new Error(`The declared MIME type does not match the ${format.id} file contents.`);
	const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
	if (extension && !format.extensions.includes(extension)) throw new Error(`The file extension does not match its ${format.id} contents.`);
	const raw = format.id === 'PNG' ? pngInfo(bytes) : format.id === 'JPEG' ? jpegInfo(bytes) : webpInfo(bytes);
	checkDimensions(raw.width, raw.height, file.size);
	return {
		format: format.id, mime: format.mime, encodedWidth: raw.width, encodedHeight: raw.height,
		width: raw.orientation >= 5 ? raw.height : raw.width,
		height: raw.orientation >= 5 ? raw.width : raw.height,
		orientation: raw.orientation
	};
}

export async function verifyOutput(blob: Blob, formatId: string): Promise<void> {
	const format = detectFormat(new Uint8Array(await blob.slice(0, 32).arrayBuffer()));
	if (!blob.size || blob.size > LIMITS.maxOutputBytes || format?.id !== formatId || blob.type !== format.mime)
		throw new Error('The browser could not encode the requested output format.');
}
