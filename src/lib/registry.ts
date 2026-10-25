import { imageFormats, imageOutputs, type FormatDefinition } from './formats.ts';
import type { EngineAdapter } from './engine-types.ts';
import { archiveFormats } from './archive-formats.ts';
import { ebookFormats } from './ebook-formats.ts';
import { audioFormats } from './audio-formats.ts';
import { videoFormats } from './video-formats.ts';

export interface AdapterDefinition {
	id: string;
	formats: readonly FormatDefinition[];
	inputs: readonly string[];
	outputs: readonly string[];
	load: () => Promise<EngineAdapter>;
}

// Register descriptors here; codec implementations are imported only inside the worker.
export const adapters: readonly AdapterDefinition[] = [{
	id: 'canvas', formats: imageFormats,
	inputs: imageFormats.map(f => f.id), outputs: imageOutputs.map(f => f.id),
	load: async () => (await import('./adapters/canvas-codec.ts')).canvasCodec
}, {
	id:'ebook', formats:ebookFormats, inputs:['EPUB'], outputs:['TXT','HTML'],
	load:async ()=>(await import('./adapters/epub.ts')).epubCodec
}, {
	id:'archive', formats:archiveFormats, inputs:archiveFormats.filter(f=>!['TAR.XZ','TAR.BZ2'].includes(f.id)).map(f=>f.id), outputs:['ZIP','TAR','TAR.GZ','GZIP','TAR.XZ','TAR.BZ2'],
	load:async ()=>(await import('./adapters/archive.ts')).archiveCodec
}, {
	id:'pcm', formats:audioFormats.slice(0,2), inputs:['WAV','AIFF'], outputs:['WAV','AIFF'],
	load:async ()=>(await import('./adapters/pcm.ts')).pcmCodec
}, {
	id:'audio',formats:audioFormats,inputs:audioFormats.map(f=>f.id),outputs:['WAV','AIFF','MP3','FLAC','OGG','OPUS','AAC','M4A'],
	load:async ()=>(await import('./adapters/audio-codec.ts')).audioCodec
}, {
	id:'video', formats:videoFormats, inputs:videoFormats.map(f=>f.id),outputs:videoFormats.map(f=>f.id),
	load:async ()=>(await import('./adapters/video.ts')).videoCodec
}];
export const formats = [...new Map(adapters.flatMap(a => a.formats).map(f => [f.id, f])).values()];
export const formatById = (id: string) => formats.find(f => f.id === id);
export const detectFormat = (bytes: Uint8Array) => formats.find(f => f.matches(bytes));

export function formatsFor(input: string, available: readonly string[]): string[] {
	return formats.filter(f => available.includes(f.id) && adapters.some(a => a.inputs.includes(input) && a.outputs.includes(f.id))).map(f => f.id);
}

export function planConversion(input: string, output: string) {
	const adapter = adapters.find(a => a.inputs.includes(input) && a.outputs.includes(output));
	if (!adapter) throw new Error('This conversion is not supported.');
	// A steps list leaves room for multi-hop planning without implementing unneeded routes.
	return { steps: [{ adapter: adapter.id, input, output }] };
}
