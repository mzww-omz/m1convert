import { ascii, type FormatDefinition } from './formats.ts';

const ebml = (b: Uint8Array, name: string) =>
	b.length >= 16 && [0x1a, 0x45, 0xdf, 0xa3].every((v, i) => b[i] === v)
	&& ascii(b, 4, Math.min(252, b.length - 4)).includes(name);

export const videoFormats: readonly FormatDefinition[] = [
	{ id: 'MP4', mime: 'video/mp4', extension: 'mp4', extensions: ['mp4', 'm4v'], quality: true,
		matches: b => isIsoBmff(b) && ascii(b, 8, 4) !== 'qt  ' },
	{ id: 'MOV', mime: 'video/quicktime', extension: 'mov', extensions: ['mov', 'qt'], quality: true,
		matches: b => isIsoBmff(b) && ascii(b, 8, 4) === 'qt  ' },
	{ id: 'WEBM', mime: 'video/webm', extension: 'webm', extensions: ['webm'], quality: true,
		matches: b => ebml(b, 'webm') },
	{ id: 'MKV', mime: 'video/x-matroska', extension: 'mkv', extensions: ['mkv'], quality: true,
		matches: b => ebml(b, 'matroska') }
];

export const videoOutputs = videoFormats.map(f => f.id);

export function isIsoBmff(b: Uint8Array) {
	return b.length >= 16 && ascii(b, 4, 4) === 'ftyp';
}

export const videoCodecs: Record<string, readonly string[]> = {
	MP4: ['avc', 'hevc', 'av1'],
	MOV: ['avc', 'hevc', 'av1'],
	WEBM: ['vp8', 'vp9', 'av1'],
	MKV: ['avc', 'hevc', 'vp8', 'vp9', 'av1']
};
