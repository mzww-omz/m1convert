import type {ImageEncodeOptions} from './image.ts';
import {EngineFallbackError,type EngineContext} from '../codec-registry.ts';
let loading:Promise<typeof import('@jsquash/png/encode.js')>|undefined;
async function loadPng() {
	if(!loading)loading=(async()=>{
		try {
			const codec=await import('@jsquash/png/encode.js');
			await codec.init(new URL(`${import.meta.env.BASE_URL}vendor/png-3.1.1/squoosh_png_bg.wasm`,location.origin));
			return codec;
		} catch(error) {
			if(error instanceof RangeError)throw error;
			throw new EngineFallbackError('unavailable','PNG WASM could not load or initialize. Check the local codec assets or use another format.');
		}
	})().catch(error=>{loading=undefined;throw error;});
	return loading;
}
export async function encodePngImage(canvas:OffscreenCanvas,_q:ImageEncodeOptions,job:EngineContext):Promise<Blob> {
	const codec=await loadPng();job.signal.throwIfAborted();
	const ctx=canvas.getContext('2d');
	if(!ctx)throw new Error('The browser could not allocate image pixels. Try a smaller source.');
	const data=ctx.getImageData(0,0,canvas.width,canvas.height);
	const bytes=await codec.default(data,{bitDepth:8});
	job.signal.throwIfAborted();
	return new Blob([bytes],{type:'image/png'});
}
