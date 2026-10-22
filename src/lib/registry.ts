import { imageFormats, type FormatDefinition } from './formats.ts';

export interface AdapterDefinition {
	id: string;
	formats: readonly FormatDefinition[];
	inputs: readonly string[];
	outputs: readonly string[];
}

// Register descriptors here; codec implementations are imported only inside the worker.
export const adapters: readonly AdapterDefinition[] = [{
	id: 'canvas', formats: imageFormats,
	inputs: imageFormats.map(f => f.id), outputs: imageFormats.map(f => f.id)
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
