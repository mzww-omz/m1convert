import { adapters, detectFormat, planConversion, formatById } from './registry.ts';
import { ascii } from './formats.ts';
import { isIsoBmff } from './video-formats.ts';
import { LIMITS } from './image-format.ts';
import { compatibilityWarnings } from './compatibility.ts';
import {detectEnvironment,detectBrowserCapabilities} from './codec-registry.ts';
import {imageEncoders} from './engines/image.ts';
import {audioDecoders,audioEncoders} from './engines/audio.ts';
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
		let lastActivity=0,activityBytes=0,streaming=false;
		const context={signal:new AbortController().signal,stage,
			streaming:()=>{if(!streaming){streaming=true;port.postMessage({type:'streaming'});}},
			activity:(bytes:number)=>{activityBytes+=bytes;if(performance.now()-lastActivity>=100){port.postMessage({type:'activity',bytes:activityBytes});activityBytes=0;lastActivity=performance.now();}},
			temporary:(name:string)=>new Promise<void>(resolve=>{
				const ready=(event:MessageEvent)=>{if(event.data.type==='temporary-ready'&&event.data.name===name){self.removeEventListener('message',ready);resolve();}};
				self.addEventListener('message',ready);port.postMessage({type:'temporary',name});
			})
		};
		const file = data.type === 'inspect' ? data.file : data.request.file;
		const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
		let input = detectFormat(head);
		// M4A and video MP4 share the ISO BMFF signature. Inspect actual tracks before routing.
		if(input?.id==='M4A' && isIsoBmff(head)) {
			const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
			const probe = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
			try { if((await probe.getVideoTracks()).length)input=formatById(ascii(head,8,4)==='qt  '?'MOV':'MP4'); }
			finally { probe.dispose(); }
		}
		if (!input) throw new Error('This file type is not supported. Choose an image, audio, video or archive.');
		if(file.size>LIMITS.maxFileBytes&&(input.mime.startsWith('image/')||input.mime.startsWith('audio/')))throw new Error('This image/audio engine needs a full input buffer (64 MiB budget). Split the source; streaming archives have a separate disk-backed path.');
		const definition = data.type === 'inspect'
			? adapters.find(a => a.inputs.includes(input.id))
			: adapters.find(a => a.id === planConversion(input.id, data.request.format).steps[0].adapter);
		if (!definition) throw new Error('This conversion is not supported.');
		const adapter = await definition.load();
		if (data.type === 'inspect') {
			const category=input.mime.startsWith('image/')?'image':input.mime.startsWith('audio/')?'audio':input.mime.startsWith('video/')?'video':undefined;
			const analysis=await adapter.inspect(file,stage,category==='image'||category==='audio'?data.verifiedOutputs?.[category]:undefined,context);
			port.postMessage({ type:'analyzed', analysis:{...analysis,codecEngines:(category==='image'?imageEncoders:category==='audio'?[...audioDecoders,...audioEncoders]:[]).map(e=>e.capability),environment:detectEnvironment(),browserCapabilities:detectBrowserCapabilities(),warnings:[...(analysis.warnings??[]),...compatibilityWarnings(file,analysis.info.format)]} });
		}
		else port.postMessage({ type: 'converted', result: await adapter.run(data.request, stage,context) });
	} catch (error) {
		port.postMessage({ type: 'error', message: error instanceof RangeError ? `The selected engine could not allocate its working memory. No lower-quality output was substituted. Close other tabs or use a smaller source. Details: ${error.message}` : error instanceof Error ? error.message : 'File processing failed. Try again.' });
	}
};
