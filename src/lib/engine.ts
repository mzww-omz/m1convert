export interface ConversionRequest {
	file: File;
	format: string;
	quality: number;
}
export type ConversionResult = { kind: 'demo' } | { kind: 'converted'; blob: Blob; name: string };
export interface ConversionEngine {
	run(request: ConversionRequest, signal: AbortSignal, onProgress: (progress: number) => void): Promise<ConversionResult>;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
		const abort = () => {
			clearTimeout(timer);
			reject(new DOMException('Cancelled', 'AbortError'));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', abort);
			resolve();
		}, ms);
		signal.addEventListener('abort', abort, { once: true });
	});
}

export const demoEngine: ConversionEngine = {
	async run(_request, signal, onProgress) {
		for (let step = 0; step < 30; step++) {
			await delay(80, signal);
			onProgress(Math.round((step / 30) * 100));
		}
		signal.throwIfAborted();
		return { kind: 'demo' };
	}
};
