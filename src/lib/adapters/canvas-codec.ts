import type { EngineAdapter, Stage } from '../engine-types.ts';
import { imageFormats, imageOutputs } from '../formats.ts';
import { readImage, verifyOutput, OutputVerificationError, type ImageInfo } from '../image-format.ts';
import {runCodec,EngineFallbackError,detectEnvironment,type EngineContext} from '../codec-registry.ts';
import {imageEncoders} from '../engines/image.ts';
import { outputName } from '../results.ts';

function checkBrowser() {
	if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined')
		throw new Error('This browser needs OffscreenCanvas and image decoding in workers. Use a current browser.');
}
function context(canvas: OffscreenCanvas) {
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('The browser could not allocate an image canvas. Try a smaller image.');
	return ctx;
}
async function rgbaBitmap(rgba: {width:number;height:number;data:Uint8ClampedArray}): Promise<ImageBitmap> {
	const canvas=new OffscreenCanvas(rgba.width,rgba.height);
	try {
		const pixels=context(canvas).createImageData(rgba.width,rgba.height);
		pixels.data.set(rgba.data); context(canvas).putImageData(pixels,0,0);
		return canvas.transferToImageBitmap();
	} finally { canvas.width=canvas.height=1; }
}
async function decode(file: Blob, info: ImageInfo, bytes:Uint8Array<ArrayBuffer>, frameIndex = info.frame): Promise<ImageBitmap> {
	let bitmap: ImageBitmap;
	if (info.format === 'TIFF') {
		const {decodeTiff}=await import('./tiff.ts');
		bitmap=await rgbaBitmap(decodeTiff(bytes));
	} else if (info.format === 'BMP') {
		const { decodeBmp }=await import('./bmp.ts');
		bitmap=await rgbaBitmap(decodeBmp(bytes));
	} else if (info.format === 'ICO') {
		const { icoFrames,decodeIconDib }=await import('./ico.ts');
		const frames=icoFrames(bytes);
		if (!Number.isInteger(frameIndex) || !frames[frameIndex!]) throw new Error('Invalid ICO frame selection.');
		const frame=frames[frameIndex!], payload=bytes.subarray(frame.offset,frame.offset+frame.length);
		if (payload[0] === 137) bitmap=await createImageBitmap(new Blob([payload],{type:'image/png'}));
		else bitmap=await rgbaBitmap(decodeIconDib(payload,frame));
		info.width=frame.width; info.height=frame.height;
	} else if (info.format === 'SVG') {
		const { svgInfo }=await import('./svg.ts');
		const { decodeSvg }=await import('./worker-svg.ts');
		bitmap=await decodeSvg(svgInfo(bytes).svg);
	} else {
		try { bitmap = await createImageBitmap(file.slice(0, file.size, info.mime), { imageOrientation: 'from-image' }); }
		catch { throw new Error('The image cannot be decoded. It may be corrupt or unsupported by this browser.'); }
	}
	if (bitmap.width !== info.width || bitmap.height !== info.height) {
		bitmap.close(); throw new Error('Decoded dimensions or EXIF orientation do not match the image header.');
	}
	return bitmap;
}
async function encode(canvas:OffscreenCanvas,id:string,quality:number,job:EngineContext,encodedBytes=0) {
	const width=canvas.width,height=canvas.height;
	return runCodec(imageEncoders,canvas,{format:id,quality,width,height,encodedBytes},job,async blob=>{
		job.stage('verifying');
		try { await verify(blob,id,width,height); }
		catch(error) {
			if(error instanceof OutputVerificationError)throw new EngineFallbackError('unsupported',error.message);
			throw error;
		}
	});
}
async function verify(blob: Blob, id: string, width: number, height: number) {
	await verifyOutput(blob,id);
	const format=imageFormats.find(f=>f.id===id)!;
	const {info,bytes}=await readImage(new File([blob],`output.${format.extension}`,{type:format.mime}),true);
	if (id==='ICO') {
		if (info.frames?.length !== 4 || info.frames.some((f,i)=> f.width!==[16,32,48,256][i] || f.height!==f.width)) throw new Error('ICO output sizes do not match.');
		for (let i=0;i<4;i++) { const bitmap=await decode(blob,{...info},bytes,i); bitmap.close(); }
	} else {
		if (info.width!==width || info.height!==height) throw new OutputVerificationError(`${id} encoder could not preserve ${width} × ${height} pixels (returned ${info.width} × ${info.height}). Try PNG or a smaller source image.`);
		const bitmap=await decode(blob,info,bytes); bitmap.close();
	}
}
async function availableOutputs(job:EngineContext,verified:readonly string[]=[]): Promise<string[]> {
	const canvas = new OffscreenCanvas(2, 2), outputs: string[] = [];
	try {
		context(canvas).fillRect(0,0,2,2);
		for (const format of imageOutputs) {
			if(verified.includes(format.id)){outputs.push(format.id);continue;}
			try { await encode(canvas,format.id,90,job); outputs.push(format.id); }
			catch { job.signal.throwIfAborted(); /* Unverified encoders are not advertised. */ }
		}
	} finally { canvas.width = canvas.height = 1; }
	return outputs;
}
async function read(file: File, stage: (stage: Stage) => void, frame?: number) {
	checkBrowser(); stage('reading');
	const {info,bytes}=await readImage(file);
	stage('decoding');
	const bitmap=await decode(file,info,bytes,frame ?? info.frame);
	return {info,bitmap};
}
export const canvasCodec: EngineAdapter = {
	async inspect(file, stage, verifiedOutputs,jobContext) {
		const job=jobContext??{signal:new AbortController().signal,stage};
		job.signal.throwIfAborted();
		const { info, bitmap } = await read(file, stage);
		const scale = Math.min(1, 320 / info.width, 180 / info.height);
		const canvas = new OffscreenCanvas(Math.max(1, Math.round(info.width * scale)), Math.max(1, Math.round(info.height * scale)));
		try {
			context(canvas).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			bitmap.close();
			const {value:preview}=await encode(canvas,'PNG',90,job);
			const outputs = await availableOutputs(job,verifiedOutputs);
			if (!outputs.length) throw new Error('No supported image encoders are available in this browser.');
			return { info, preview, outputs,codecEngines:imageEncoders.map(e=>e.capability),environment:detectEnvironment() };
		} finally { bitmap.close(); canvas.width = canvas.height = 1; }
	},
	async run(request, stage,jobContext) {
		const job=jobContext??{signal:new AbortController().signal,stage};
		job.signal.throwIfAborted();
		if (!imageOutputs.some(f=>f.id===request.format)) throw new Error('This output format is not supported.');
		if (!Number.isFinite(request.quality) || request.quality < 1 || request.quality > 100) throw new Error('Quality must be between 1 and 100.');
		const { info, bitmap } = await read(request.file, stage, request.frame);
		const canvas = new OffscreenCanvas(info.width, info.height);
		try {
			const ctx = context(canvas);
			if (request.format === 'JPEG') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, info.width, info.height); }
			ctx.drawImage(bitmap, 0, 0); bitmap.close();
			stage('encoding');
			const {value:blob,engineId,fallbackFrom}=await encode(canvas,request.format,request.quality,job,request.file.size);
			canvas.width = canvas.height = 1;
			return { blob,engines:{encoder:engineId,fallbackFrom}, name:outputName(request.file.name,request.format), format:request.format, mime:blob.type,
				width:request.format==='ICO' ? 256 : info.width, height:request.format==='ICO' ? 256 : info.height };
		} finally { bitmap.close(); canvas.width = canvas.height = 1; }
	}
};
