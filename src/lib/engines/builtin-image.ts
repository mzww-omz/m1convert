import {imageFormats} from '../formats.ts';
import type {ImageEncodeOptions} from './image.ts';
import type {EngineContext} from '../codec-registry.ts';
function context(canvas:OffscreenCanvas) {
	const ctx=canvas.getContext('2d');
	if(!ctx)throw new Error('The browser could not allocate an image canvas. Try a smaller image.');
	return ctx;
}
export async function encodeBuiltinImage(canvas:OffscreenCanvas,q:ImageEncodeOptions,job:EngineContext):Promise<Blob> {
	job.signal.throwIfAborted();
	const mime=imageFormats.find(f=>f.id===q.format)!.mime;
	if(['PBM','PGM','PPM'].includes(q.format)) {
		const {encodePnm}=await import('../adapters/pnm.ts');
		return new Blob([encodePnm(context(canvas).getImageData(0,0,canvas.width,canvas.height),q.format as 'PBM'|'PGM'|'PPM')],{type:mime});
	}
	if(q.format==='TIFF') {
		const {encodeTiff}=await import('../adapters/tiff.ts');
		return new Blob([encodeTiff(context(canvas).getImageData(0,0,canvas.width,canvas.height))],{type:mime});
	}
	if(q.format==='BMP') {
		const {encodeBmp}=await import('../adapters/bmp.ts');
		return new Blob([encodeBmp(context(canvas).getImageData(0,0,canvas.width,canvas.height))],{type:mime});
	}
	if(q.format!=='ICO')throw new Error('Unsupported built-in image encoder.');
	const {encodeIco}=await import('../adapters/ico.ts'),frames=[];
	for(const size of [16,32,48,256]) {
		job.signal.throwIfAborted();
		const icon=new OffscreenCanvas(size,size);
		try {
			const scale=Math.min(size/canvas.width,size/canvas.height),w=canvas.width*scale,h=canvas.height*scale;
			context(icon).drawImage(canvas,(size-w)/2,(size-h)/2,w,h);
			const png=await icon.convertToBlob({type:'image/png'});
			frames.push({width:size,height:size,bytes:new Uint8Array(await png.arrayBuffer())});
		} finally { icon.width=icon.height=1; }
	}
	return new Blob([encodeIco(frames)],{type:mime});
}
