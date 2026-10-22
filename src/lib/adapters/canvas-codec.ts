import type { EngineAdapter, Stage } from '../engine-types.ts';
import { imageFormats } from '../formats.ts';
import { inspectFile, verifyOutput, type ImageInfo } from '../image-format.ts';
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

async function decode(file: Blob, info: ImageInfo): Promise<ImageBitmap> {
	let bitmap: ImageBitmap;
	try { bitmap = await createImageBitmap(file.slice(0, file.size, info.mime), { imageOrientation: 'from-image' }); }
	catch { throw new Error('The image cannot be decoded. It may be corrupt or unsupported by this browser.'); }
	if (bitmap.width !== info.width || bitmap.height !== info.height) {
		bitmap.close();
		throw new Error('Decoded dimensions or EXIF orientation do not match the image header.');
	}
	return bitmap;
}

async function availableOutputs(): Promise<string[]> {
	const canvas = new OffscreenCanvas(1, 1);
	const outputs: string[] = [];
	try {
		context(canvas).fillRect(0, 0, 1, 1);
		for (const format of imageFormats) {
			try {
				const blob = await canvas.convertToBlob({ type: format.mime, quality: 0.9 });
				await verifyOutput(blob, format.id);
				outputs.push(format.id);
			} catch { /* An unsupported encoder may silently return PNG. */ }
		}
	} finally { canvas.width = canvas.height = 1; }
	return outputs;
}

async function read(file: File, stage: (stage: Stage) => void) {
	checkBrowser();
	stage('reading');
	const info = await inspectFile(file);
	stage('decoding');
	const bitmap = await decode(file, info);
	return { info, bitmap };
}

export const canvasCodec: EngineAdapter = {
	async inspect(file, stage) {
		const { info, bitmap } = await read(file, stage);
		const scale = Math.min(1, 320 / info.width, 180 / info.height);
		const canvas = new OffscreenCanvas(Math.max(1, Math.round(info.width * scale)), Math.max(1, Math.round(info.height * scale)));
		try {
			context(canvas).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			bitmap.close();
			const preview = await canvas.convertToBlob({ type: 'image/png' });
			const outputs = await availableOutputs();
			if (!outputs.length) throw new Error('No supported image encoders are available in this browser.');
			return { info, preview, outputs };
		} finally {
			bitmap.close();
			canvas.width = canvas.height = 1;
		}
	},

	async run(request, stage) {
		const format = imageFormats.find(f => f.id === request.format);
		if (!format) throw new Error('This output format is not supported.');
		if (!Number.isFinite(request.quality) || request.quality < 1 || request.quality > 100) throw new Error('Quality must be between 1 and 100.');
		const { info, bitmap } = await read(request.file, stage);
		const canvas = new OffscreenCanvas(info.width, info.height);
		try {
			const ctx = context(canvas);
			if (format.id === 'JPEG') {
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, info.width, info.height);
			}
			ctx.drawImage(bitmap, 0, 0);
			bitmap.close();
			stage('encoding');
			const blob = await canvas.convertToBlob({ type: format.mime, quality: request.quality / 100 });
			canvas.width = canvas.height = 1;
			stage('verifying');
			await verifyOutput(blob, format.id);
			const name = outputName(request.file.name, format.id);
			const check = await decode(blob, { ...info, mime: format.mime });
			check.close();
			return { blob, name, format: format.id, mime: format.mime, width: info.width, height: info.height };
		} finally {
			bitmap.close();
			canvas.width = canvas.height = 1;
		}
	}
};
