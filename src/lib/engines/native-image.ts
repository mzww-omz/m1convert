import {imageFormats} from '../formats.ts';
import {EngineFallbackError,type EngineContext} from '../codec-registry.ts';
import type {ImageEncodeOptions} from './image.ts';
export async function encodeNativeImage(canvas:OffscreenCanvas,q:ImageEncodeOptions,context:EngineContext):Promise<Blob> {
	context.signal.throwIfAborted();
	const mime=imageFormats.find(f=>f.id===q.format)!.mime;
	try {
		const blob=await canvas.convertToBlob({type:mime,quality:q.quality/100});
		if(blob.type!==mime)throw new EngineFallbackError('unsupported',`Native ${q.format} encoder returned ${blob.type} instead.`);
		return blob;
	} catch(error) {
		if(error instanceof DOMException&&['NotSupportedError','EncodingError'].includes(error.name))
			throw new EngineFallbackError('unsupported',`${q.format} encoding failed for ${q.width} × ${q.height} pixels in this browser. Try PNG, a lower quality, or a smaller source image.`);
		throw error;
	}
}
