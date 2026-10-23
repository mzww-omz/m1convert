import type {StageReporter} from './engine-types.ts';

export interface EngineEnvironment {
	wasm:boolean; wasmSimd:boolean; sharedMemory:boolean;
	offscreenCanvas:boolean; imageBitmap:boolean; canvasEncoding:boolean;
	audioEncoder:boolean; audioDecoder:boolean; compression:boolean; decompression:boolean;
}
export interface EngineCapability {
	id:string;
	kind:'native'|'webcodecs'|'wasm'|'builtin';
	operation:'decode'|'encode';
	formats:readonly string[];
	quality:'lossless'|'percentage'|'bitrate'|'bitrate-or-quality'|'not-applicable';
	containers:readonly string[];
	requirements:readonly (keyof EngineEnvironment)[];
	limits:readonly string[];
}
export interface EngineAvailability extends EngineCapability { available:boolean; reason?:string }
export interface EngineContext { signal:AbortSignal; stage:StageReporter }
export interface CodecSession<Input,Output,Options> {
	run(input:Input,options:Options,context:EngineContext):Promise<Output>;
	dispose?():void|Promise<void>;
}
export interface CodecEngine<Input,Output,Options extends {format:string}> {
	capability:EngineCapability;
	supports?(options:Options,environment:EngineEnvironment):string|undefined|Promise<string|undefined>;
	load():Promise<CodecSession<Input,Output,Options>>;
}
// Only explicitly classified availability/configuration failures may cross to another engine.
export class EngineFallbackError extends Error {
	constructor(public readonly code:'unavailable'|'unsupported',message:string) { super(message); this.name='EngineFallbackError'; }
}
export function detectEnvironment(scope:Record<string,any>=globalThis):EngineEnvironment {
	const wasm=typeof scope.WebAssembly==='object';
	let wasmSimd=false,sharedMemory=false;
	if(wasm) {
		try { wasmSimd=scope.WebAssembly.validate(Uint8Array.of(0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11)); } catch {/* Optional feature. */}
		if(scope.crossOriginIsolated===true&&typeof scope.SharedArrayBuffer==='function')try {
			sharedMemory=new scope.WebAssembly.Memory({initial:1,maximum:1,shared:true}).buffer instanceof scope.SharedArrayBuffer;
		} catch {/* Baseline engines do not require shared memory. */}
	}
	return {wasm,wasmSimd,sharedMemory,
		offscreenCanvas:typeof scope.OffscreenCanvas==='function',imageBitmap:typeof scope.createImageBitmap==='function',
		canvasEncoding:typeof scope.OffscreenCanvas?.prototype?.convertToBlob==='function',
		audioEncoder:typeof scope.AudioEncoder==='function',audioDecoder:typeof scope.AudioDecoder==='function',
		compression:typeof scope.CompressionStream==='function',decompression:typeof scope.DecompressionStream==='function'};
}
async function availability<I,O,Q extends {format:string}>(engine:CodecEngine<I,O,Q>,options:Q,env:EngineEnvironment):Promise<EngineAvailability> {
	const cap=engine.capability;
	let reason:string|undefined;
	if(!cap.formats.includes(options.format))reason=`${options.format} is not provided by this engine.`;
	else {
		const missing=cap.requirements.filter(feature=>!env[feature]);
		reason=missing.length?`Missing browser features: ${missing.join(', ')}.`:await engine.supports?.(options,env);
	}
	return {...cap,available:!reason,...(reason?{reason}:{})};
}
export function engineCapabilities<I,O,Q extends {format:string}>(engines:readonly CodecEngine<I,O,Q>[],options:Q,env=detectEnvironment()) {
	return Promise.all(engines.map(engine=>availability(engine,options,env)));
}
export async function runCodec<I,O,Q extends {format:string}>(
	engines:readonly CodecEngine<I,O,Q>[],input:I,options:Q,context:EngineContext,
	verify:(output:O)=>void|Promise<void>,env=detectEnvironment()
):Promise<{value:O;engineId:string;fallbackFrom:string[]}> {
	const reasons:string[]=[],fallbackFrom:string[]=[];
	for(const engine of engines) {
		context.signal.throwIfAborted();
		const status=await availability(engine,options,env);
		context.signal.throwIfAborted();
		if(!status.available) { reasons.push(`${status.id}: ${status.reason}`); continue; }
		let session:CodecSession<I,O,Q>|undefined;
		try {
			session=await engine.load();
			context.signal.throwIfAborted();
			const value=await session.run(input,options,context);
			context.signal.throwIfAborted();
			await verify(value);
			context.signal.throwIfAborted();
			return {value,engineId:status.id,fallbackFrom};
		} catch(error) {
			context.signal.throwIfAborted();
			if(!(error instanceof EngineFallbackError))throw error;
			fallbackFrom.push(status.id);reasons.push(`${status.id}: ${error.message}`);
		} finally { await session?.dispose?.(); }
	}
	context.signal.throwIfAborted();
	throw new Error(`No engine could process ${options.format}. ${reasons.join(' ')}`);
}
