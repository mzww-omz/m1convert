import type {CodecEngine} from '../codec-registry.ts';
import {LIMITS} from '../image-format.ts';
export interface ImageEncodeOptions { format:string; quality:number; width:number; height:number; encodedBytes:number }
export const imageEncoders:readonly CodecEngine<OffscreenCanvas,Blob,ImageEncodeOptions>[]=[{
	capability:{id:'native-canvas',kind:'native',operation:'encode',formats:['PNG','JPEG','WEBP','AVIF'],
		quality:{PNG:'lossless',JPEG:'percentage',WEBP:'percentage',AVIF:'percentage'},containers:['PNG','JPEG','WEBP','AVIF'],
		requirements:['offscreenCanvas','canvasEncoding'],limits:['256 MiB estimated image working set','64 MiB encoded output','Exact format and dimensions verified; browser-dependent sizes']},
	load:async()=>({run:(await import('./native-image.ts')).encodeNativeImage})
},{
	capability:{id:'builtin-image',kind:'builtin',operation:'encode',formats:['BMP','ICO','TIFF'],
		quality:{BMP:'lossless',ICO:'lossless',TIFF:'lossless'},containers:['BMP V4','ICO/PNG','classic TIFF'],
		requirements:['offscreenCanvas'],limits:['24/32-bit BMP decode; RGBA BMP encode','ICO output: 16/32/48/256 px','Single-page uncompressed RGBA8 TIFF','256 MiB estimated image working set; 64 MiB output']},
	supports:(q,env)=>q.format==='ICO'&&!env.canvasEncoding?'ICO PNG frames require Canvas encoding.':undefined,
	load:async()=>({run:(await import('./builtin-image.ts')).encodeBuiltinImage})
},{
	capability:{id:'wasm-png',kind:'wasm',operation:'encode',formats:['PNG'],quality:{PNG:'lossless'},containers:['PNG'],
		requirements:['wasm','offscreenCanvas'],limits:['8-bit RGBA only','Single-thread; no SIMD/shared memory requirement','Conservative 20 bytes/pixel + 2 × source bytes <= 256 MiB','64 MiB encoded output']},
	supports:q=>q.width*q.height*20+q.encodedBytes*2>LIMITS.maxWorkingBytes?'Safety limit: PNG WASM working memory budget would be exceeded.':undefined,
	load:async()=>({run:(await import('./png-wasm.ts')).encodePngImage})
}];
