import { adapters, detectFormat, planConversion } from './registry.ts';
import { LIMITS } from './image-format.ts';
import type { Stage, WorkerReply, WorkerRequest } from './engine-types.ts';

const port = self as unknown as {
	onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
	postMessage: (reply: WorkerReply) => void;
};
let lastStage:Stage|undefined,lastPercent:number|undefined;
const stage = (value: Stage, percent?:number) => {
	const measured=percent===undefined?undefined:Math.floor(percent);
	if(value===lastStage&&measured===lastPercent)return;
	lastStage=value;lastPercent=measured;
	port.postMessage({ type: 'stage', stage: value, ...(measured===undefined?{}:{percent:measured}) });
};

port.onmessage = async ({ data }) => {
	if (data.type !== 'inspect' && data.type !== 'convert') return;
	try {
		const file = data.type === 'inspect' ? data.file : data.request.file;
		if (file.size > LIMITS.maxFileBytes) throw new Error('File exceeds the 32 MiB limit.');
		const input = detectFormat(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
		if (!input) throw new Error('This file is not supported. Choose a supported image, PCM audio or archive.');
		const definition = data.type === 'inspect'
			? adapters.find(a => a.inputs.includes(input.id))
			: adapters.find(a => a.id === planConversion(input.id, data.request.format).steps[0].adapter);
		if (!definition) throw new Error('This conversion is not supported.');
		const adapter = await definition.load();
		if (data.type === 'inspect') {
			const category=input.mime.startsWith('image/')?'image':input.mime.startsWith('audio/')?'audio':undefined;
			port.postMessage({ type:'analyzed', analysis:await adapter.inspect(file,stage,category?data.verifiedOutputs?.[category]:undefined) });
		}
		else port.postMessage({ type: 'converted', result: await adapter.run(data.request, stage) });
	} catch (error) {
		port.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'File processing failed. Try again.' });
	}
};
