export interface FormatDefinition {
	id: string;
	mime: string;
	extension: string;
	extensions: readonly string[];
	quality: boolean;
	matches: (bytes: Uint8Array) => boolean;
}

export const imageFormats: readonly FormatDefinition[] = [
	{ id: 'PNG', mime: 'image/png', extension: 'png', extensions: ['png'], quality: false,
		matches: b => [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v) },
	{ id: 'JPEG', mime: 'image/jpeg', extension: 'jpg', extensions: ['jpg', 'jpeg', 'jpe'], quality: true,
		matches: b => b[0] === 255 && b[1] === 216 && b[2] === 255 },
	{ id: 'WEBP', mime: 'image/webp', extension: 'webp', extensions: ['webp'], quality: true,
		matches: b => b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' },
	{ id: 'AVIF', mime: 'image/avif', extension: 'avif', extensions: ['avif'], quality: true,
		matches: b => {
			if (b.length < 16 || ascii(b,4,4) !== 'ftyp') return false;
			const end=Math.min(new DataView(b.buffer,b.byteOffset,b.length).getUint32(0),b.length,4096);
			for (let p=8;p+4<=end;p+=4) if (p!==12 && ['avif','avis'].includes(ascii(b,p,4))) return true;
			return false;
		} },
	{ id: 'BMP', mime: 'image/bmp', extension: 'bmp', extensions: ['bmp'], quality: false,
		matches: b => b[0] === 66 && b[1] === 77 },
	{ id: 'ICO', mime: 'image/x-icon', extension: 'ico', extensions: ['ico'], quality: false,
		matches: b => b.length >= 6 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 },
	{ id: 'SVG', mime: 'image/svg+xml', extension: 'svg', extensions: ['svg'], quality: false,
		matches: b => /^\s*(?:<\?xml\s[^?]*\?>\s*)?(?:<!DOCTYPE\s[^>]*>\s*)?<svg(?:\s|\/?>)/i.test(new TextDecoder().decode(b.subarray(0,4096))) }
];

export function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
