import type { Analysis, ConversionEngine, ConversionResult, Progress, WorkerReply, WorkerRequest } from './engine-types.ts';

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;

export function createWorkerEngine(
	createWorker: () => WorkerPort = () => {
		if (typeof Worker === 'undefined') throw new Error('This browser cannot run image workers. Use a current browser.');
		return new Worker(new URL('./conversion.worker.ts', import.meta.url), { type: 'module' });
	}, timeoutMs = 30_000,
	rasterize = async (svg: string, signal: AbortSignal) => (await import('./adapters/svg-raster.ts')).rasterizeSvg(svg,signal)
): ConversionEngine {
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
			const timer = setTimeout(() => finish(new Error('Image processing timed out. Try a smaller image.')), timeoutMs);
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
				else if (reply.type === 'stage') onProgress({ stage: reply.stage, percent: null });
				else if (reply.type === 'error') finish(new Error(reply.message));
				else if ((request.type === 'inspect' && reply.type === 'analyzed') || (request.type === 'convert' && reply.type === 'converted')) finish(undefined, reply);
				else finish(new Error('The image worker returned an unexpected response.'));
			};
			worker.onerror = event => { event.preventDefault(); finish(new Error('The image worker could not finish. Try again or use a current browser.')); };
			worker.onmessageerror = () => finish(new Error('The image worker response could not be read. Try again.'));
			try { worker.postMessage(request); } catch { finish(new Error('The file could not be sent to the local image worker.')); }
		});
	}

	return {
		async inspect(file, signal) {
			const reply = await job({ type: 'inspect', file }, signal, () => {});
			return (reply as { type: 'analyzed'; analysis: Analysis }).analysis;
		},
		async run(request, signal, onProgress) {
			const reply = await job({ type: 'convert', request }, signal, onProgress);
			return (reply as { type: 'converted'; result: ConversionResult }).result;
		}
	};
}
