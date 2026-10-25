import type {ImageEncodeOptions} from './image.ts';
import type {EngineContext} from '../codec-registry.ts';
import {checkDimensions,LIMITS} from '../image-format.ts';

export async function encodeJxlImage(canvas:OffscreenCanvas,options:ImageEncodeOptions,job:EngineContext):Promise<Blob> {
	job.signal.throwIfAborted();
	checkDimensions(canvas.width,canvas.height,options.encodedBytes);
	const ctx=canvas.getContext('2d',{willReadFrequently:true});
	if(!ctx) throw new Error('JPEG XL needs a readable image canvas.');
	const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
	job.signal.throwIfAborted();
	const {default:encode}=await import('@jsquash/jxl/encode.js');
	const output=await encode(pixels,{quality:options.quality,effort:5});
	job.signal.throwIfAborted();
	if(!output.byteLength || output.byteLength>LIMITS.maxOutputBytes) throw new Error('JPEG XL output exceeded the 64 MiB safety limit.');
	return new Blob([output],{type:'image/jxl'});
}
