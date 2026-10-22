import type { Analysis, ConversionEngine, ConversionResult, Progress, WorkerReply, WorkerRequest, VerifiedOutputs } from './engine-types.ts';

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;

export function createWorkerEngine(
	createWorker: () => WorkerPort = () => {
		if (typeof Worker === 'undefined') throw new Error('This browser cannot run file conversion workers. Use a current browser.');
		return new Worker(new URL('./conversion.worker.ts', import.meta.url), { type: 'module' });
	}, timeoutMs = 30_000,
	rasterize = async (svg: string, signal: AbortSignal) => (await import('./adapters/svg-raster.ts')).rasterizeSvg(svg,signal)
): ConversionEngine {
	// Remember only proven format IDs, never the disposable worker's file buffers or WASM heap.
	let verifiedOutputs:VerifiedOutputs={};
	function job(request: WorkerRequest, signal: AbortSignal, onProgress: (progress: Progress) => void): Promise<WorkerReply> {
		return new Promise((resolve, reject) => {
			if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
			let worker: WorkerPort;
			try { worker = createWorker(); } catch (error) { reject(error); return; }
			let settled = false, rasterizing = false;
			const resources = new AbortController();
			const finish = (error?: Error, reply?: WorkerReply) => {
				if (settled) return;
				settled = true;
				resources.abort();
				clearTimeout(timer);
				signal.removeEventListener('abort', abort);
				worker.onmessage = worker.onerror = worker.onmessageerror = null;
				worker.terminate();
				if (error) reject(error); else if (reply) resolve(reply);
			};
			const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
			const timer = setTimeout(() => finish(new Error('File processing timed out. Try a smaller file or batch.')), timeoutMs);
			signal.addEventListener('abort', abort, { once: true });
			worker.onmessage = event => {
				if (settled) return;
				const reply = event.data as WorkerReply;
				if (reply.type === 'rasterize') {
					if (rasterizing) return finish(new Error('Unexpected SVG rasterization request.'));
					rasterizing=true;
					void rasterize(reply.svg,resources.signal).then(bitmap => {
						if (settled) { bitmap.close(); return; }
						try { worker.postMessage({ type:'rasterized', bitmap },[bitmap]); }
						catch { bitmap.close(); finish(new Error('SVG bitmap could not be transferred.')); }
					}, () => finish(new Error('SVG could not be rasterized in this browser.')));
				}
				else if (reply.type === 'stage') onProgress({ stage: reply.stage, percent: reply.percent===undefined||!Number.isFinite(reply.percent)?null:Math.max(0,Math.min(99,reply.percent)) });
				else if (reply.type === 'error') finish(new Error(reply.message));
				else if ((request.type === 'inspect' && reply.type === 'analyzed') || (request.type === 'convert' && reply.type === 'converted')) finish(undefined, reply);
				else finish(new Error('The conversion worker returned an unexpected response.'));
			};
			worker.onerror = event => { event.preventDefault(); finish(new Error('The conversion worker could not finish. Try again or use a current browser.')); };
			worker.onmessageerror = () => finish(new Error('The conversion worker response could not be read. Try again.'));
			try { worker.postMessage(request); } catch { finish(new Error('The file could not be sent to the local conversion worker.')); }
		});
	}

	return {
		async inspect(file, signal) {
			try {
				const snapshot=Object.fromEntries(Object.entries(verifiedOutputs).map(([category,outputs])=>[category,[...outputs]]));
				const reply = await job({ type: 'inspect', file, verifiedOutputs:snapshot }, signal, () => {});
				const analysis=(reply as { type:'analyzed'; analysis:Analysis }).analysis;
				const category=analysis.info.category==='audio'?'audio':analysis.info.mime.startsWith('image/')?'image':undefined;
				if(category&&!signal.aborted)verifiedOutputs[category]=[...new Set([...(verifiedOutputs[category]??[]),...analysis.outputs])];
				return analysis;
			} catch(error) { if(!signal.aborted)verifiedOutputs={}; throw error; }
		},
		async run(request, signal, onProgress) {
			try {
				const reply = await job({ type: 'convert', request }, signal, onProgress);
				return (reply as { type: 'converted'; result: ConversionResult }).result;
			} catch(error) { if(!signal.aborted)verifiedOutputs={}; throw error; }
		}
	};
}
