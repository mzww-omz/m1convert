import { BufferTarget, StreamTarget, type Target } from 'mediabunny';
import type { EngineContext } from './codec-registry.ts';
import { BLOB_LIMIT, STREAM_LIMIT, TEMP_DIRECTORY } from './stream-output.ts';

interface LocalTarget {
	target: Target;
	finish(mime: string): Promise<{ blob: Blob; temporaryFile?: string }>;
	abort(): Promise<void>;
}

export async function createVideoTarget(file: File, job: EngineContext): Promise<LocalTarget> {
	job.signal.throwIfAborted();
	let handle: FileSystemFileHandle | undefined;
	let writer: FileSystemWritableFileStream | undefined;
	let temporaryFile: string | undefined;
	let limit = STREAM_LIMIT;
	try {
		if (job.temporary && typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle(TEMP_DIRECTORY, { create: true });
			const estimate = await navigator.storage.estimate();
			if (estimate.quota !== undefined && estimate.usage !== undefined)
				limit = Math.min(limit, Math.max(0, Math.floor((estimate.quota - estimate.usage) * 0.8)));
			temporaryFile = 'convert-' + crypto.randomUUID();
			await job.temporary(temporaryFile);
			handle = await dir.getFileHandle(temporaryFile);
			writer = await handle.createWritable();
		}
	} catch (error) {
		if (temporaryFile) throw new Error('Temporary video output could not open. Free browser storage and retry.');
		if (!['NotSupportedError', 'SecurityError', 'UnknownError'].includes((error as DOMException).name))
			throw error;
	}
	if (!writer || !handle || !temporaryFile) {
		if (file.size > BLOB_LIMIT)
			throw new Error('This browser cannot use disk-backed video output. Try a file under 64 MiB in an OPFS-capable browser.');
		const target = new BufferTarget();
		return {
			target,
			async finish(mime) {
				const buffer = target.buffer;
				if (!buffer?.byteLength || buffer.byteLength > BLOB_LIMIT)
					throw new Error('Video output is empty or exceeds the 64 MiB in-memory budget.');
				return { blob: new Blob([buffer], { type: mime }) };
			},
			async abort() { /* A disposable worker releases in-memory output. */ }
		};
	}
	let finalSize = 0;
	let closed = false;
	const diskWriter = writer;
	const diskHandle = handle;
	const tempName = temporaryFile;
	const writable = new WritableStream<{ type: 'write'; data: Uint8Array<ArrayBuffer>; position: number }>({
		async write(chunk) {
			job.signal.throwIfAborted();
			if (chunk.type !== 'write' || !Number.isSafeInteger(chunk.position) || chunk.position < 0 || chunk.position + chunk.data.length > limit)
				throw new Error('Video output exceeds the available disk/2 GiB safety budget.');
			await diskWriter.write({ type: 'write', position: chunk.position, data: chunk.data });
			finalSize = Math.max(finalSize, chunk.position + chunk.data.length);
			job.activity?.(chunk.data.length);
		},
		async close() {
			await diskWriter.close();
			closed = true;
		},
		async abort() {
			await diskWriter.abort().catch(() => {});
			closed = true;
		}
	});
	return {
		target: new StreamTarget(writable, { chunked: true, chunkSize: 1024 * 1024 }),
		async finish(mime) {
			job.signal.throwIfAborted();
			if (!closed) { await diskWriter.close(); closed = true; }
			if (!finalSize) throw new Error('Video encoder produced an empty output.');
			return { blob: (await diskHandle.getFile()).slice(0, finalSize, mime), temporaryFile: tempName };
		},
		async abort() {
			if (!closed) await diskWriter.abort().catch(() => {});
			closed = true;
			// Main thread owns the temporary-file lease and deletes it on error or cancellation.
		}
	};
}
