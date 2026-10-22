import { adapters, detectFormat, planConversion } from './registry.ts';
import { LIMITS } from './image-format.ts';
import type { Stage, WorkerReply, WorkerRequest } from './engine-types.ts';

const port = self as unknown as {
	onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
	postMessage: (reply: WorkerReply) => void;
};
const stage = (value: Stage) => port.postMessage({ type: 'stage', stage: value });

port.onmessage = async ({ data }) => {
	if (data.type !== 'inspect' && data.type !== 'convert') return;
	try {
		const file = data.type === 'inspect' ? data.file : data.request.file;
		if (file.size > LIMITS.maxFileBytes) throw new Error('File exceeds the 32 MiB limit.');
		const input = detectFormat(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
		if (!input) throw new Error('This file is not supported. Choose a supported still image.');
		const definition = data.type === 'inspect'
			? adapters.find(a => a.inputs.includes(input.id))
			: adapters.find(a => a.id === planConversion(input.id, data.request.format).steps[0].adapter);
		if (!definition) throw new Error('This conversion is not supported.');
		const adapter = await definition.load();
		if (data.type === 'inspect') port.postMessage({ type: 'analyzed', analysis: await adapter.inspect(file, stage) });
		else port.postMessage({ type: 'converted', result: await adapter.run(data.request, stage) });
	} catch (error) {
		port.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Image processing failed. Try again.' });
	}
};
