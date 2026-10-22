// Only the worker's validated static SVG subset reaches this async image decoder.
// No source is inserted into the document; the bitmap is transferred back to the worker.
export async function rasterizeSvg(svg: string, signal: AbortSignal): Promise<ImageBitmap> {
	const url = URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
	const image = new Image();
	let rejectAbort: (reason: Error) => void = () => {};
	const cancelled = new Promise<never>((_,reject) => { rejectAbort=reject; });
	const abort = () => { image.src=''; URL.revokeObjectURL(url); rejectAbort(new DOMException('Cancelled','AbortError')); };
	signal.addEventListener('abort',abort,{once:true});
	try {
		if (signal.aborted) throw new DOMException('Cancelled','AbortError');
		image.src=url;
		await Promise.race([image.decode(),cancelled]);
		if (signal.aborted) throw new DOMException('Cancelled','AbortError');
		const bitmap=await createImageBitmap(image);
		if (signal.aborted) { bitmap.close(); throw new DOMException('Cancelled','AbortError'); }
		return bitmap;
	} finally { signal.removeEventListener('abort',abort); image.src=''; URL.revokeObjectURL(url); }
}
