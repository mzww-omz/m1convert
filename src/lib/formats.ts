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
		matches: b => b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' }
];

export function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
