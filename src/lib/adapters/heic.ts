import {checkDimensions} from '../image-format.ts';

type HeifImage={
	get_width():number;get_height():number;
	display(pixels:{data:Uint8ClampedArray;width:number;height:number},
		callback:(result:{data:Uint8ClampedArray;width:number;height:number}|null)=>void):void;
};
let modulePromise:Promise<{HeifDecoder:new()=>{decode(bytes:Uint8Array):HeifImage[]}}>|undefined;
async function heif() {
	modulePromise??=import('libheif-js/libheif-wasm/libheif-bundle.mjs').then(({default:factory})=>factory());
	return modulePromise;
}
async function source(bytes:Uint8Array) {
	const lib=await heif();
	let images:HeifImage[];
	try{images=new lib.HeifDecoder().decode(bytes);}
	catch{throw new Error('HEIC/HEIF image metadata could not be decoded.');}
	if (!Array.isArray(images)||images.length===0) throw new Error('HEIC/HEIF contains no supported image.');
	if (images.length!==1) throw new Error('HEIC/HEIF multi-image sequences are not supported yet.');
	const image=images[0],width=image.get_width(),height=image.get_height();
	checkDimensions(width,height,bytes.length);
	return {image,width,height};
}
export async function heicInfo(bytes:Uint8Array) {
	const {width,height}=await source(bytes);
	return {width,height};
}
export async function decodeHeic(bytes:Uint8Array) {
	const {image,width,height}=await source(bytes);
	const pixels={width,height,data:new Uint8ClampedArray(width*height*4)};
	const result=await new Promise<{width:number;height:number;data:Uint8ClampedArray}>((resolve,reject)=>{
		try{image.display(pixels,output=>output?resolve(output):reject(new Error('HEIC/HEIF pixel decoding failed.')));}
		catch(error){reject(error);}
	});
	if(result.width!==width||result.height!==height||result.data.length!==width*height*4)
		throw new Error('HEIC/HEIF decoder returned incorrect pixel dimensions.');
	return result;
}
