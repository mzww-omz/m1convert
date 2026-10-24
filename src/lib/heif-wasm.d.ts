declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
	type HeifImage={
		get_width():number;get_height():number;
		display(pixels:{data:Uint8ClampedArray;width:number;height:number},
			callback:(result:{data:Uint8ClampedArray;width:number;height:number}|null)=>void):void;
	};
	const factory:()=>Promise<{HeifDecoder:new()=>{decode(bytes:Uint8Array):HeifImage[]}}>;
	export default factory;
}
