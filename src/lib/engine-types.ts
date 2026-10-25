import type {EngineCapability,EngineContext,EngineEnvironment,BrowserCapabilities} from './codec-registry.ts';
export type Stage = 'reading' | 'decoding' | 'encoding' | 'verifying';
export interface Progress { stage: Stage; percent: number | null }
export const stageLabels: Record<Stage, string> = {
	reading: 'Reading file', decoding: 'Decoding file', encoding: 'Encoding file', verifying: 'Checking output'
};
export interface AudioSettings { sampleRate:number; channels:number; bitrate?:number; mode?:'bitrate'|'quality' }
export interface ArchiveSettings { compression:'store'|'deflate' }
export interface VideoSettings { mode:'auto'|'remux'|'transcode'; codec:'auto'|'avc'|'vp8'|'vp9'|'hevc'|'av1' }
export interface ConversionRequest { file: File; format: string; quality: number; frame?: number; audio?:AudioSettings; archive?:ArchiveSettings; video?:VideoSettings; files?:File[] }
export interface ConversionResult {
	blob: Blob;
	name: string;
	format: string;
	mime: string;
	width?: number;
	height?: number;
	engines?: {decoder?:string;encoder?:string;fallbackFrom?:string[]};
	temporaryFile?:string;
	resources?:{mode:string;bytesWritten:number;maxChunkBytes:number;retainedBytes:number};
}
export interface AssetInfo { format: string; mime: string; width?: number; height?: number; frames?: {width:number;height:number}[]; frame?:number; category?:'audio'|'archive'|'video'|'ebook'; entries?:number; sampleRate?:number; channels?:number; duration?:number; codec?:string; audioCodec?:string }
export interface Analysis { info: AssetInfo; outputs: string[]; preview: Blob | null; warnings?:string[]; codecEngines?:EngineCapability[]; environment?:EngineEnvironment; browserCapabilities?:BrowserCapabilities }
export type StageReporter=(stage:Stage,percent?:number)=>void;
export interface EngineAdapter {
	inspect(file: File, stage: StageReporter, verifiedOutputs?:readonly string[], context?:EngineContext): Promise<Analysis>;
	run(request: ConversionRequest, stage: StageReporter, context?:EngineContext): Promise<ConversionResult>;
}
export interface ConversionEngine {
	inspect(file: File, signal: AbortSignal): Promise<Analysis>;
	run(request: ConversionRequest, signal: AbortSignal, onProgress: (progress: Progress) => void): Promise<ConversionResult>;
}
export type VerifiedOutputs = Partial<Record<'image'|'audio',string[]>>;
export type WorkerRequest = {type:'temporary-ready';name:string} | { type: 'inspect'; file: File; verifiedOutputs?:VerifiedOutputs } | { type: 'convert'; request: ConversionRequest };
export type WorkerReply =
	| { type:'temporary'; name:string }
	| { type:'streaming' }
	| { type:'activity'; bytes:number }
	| { type: 'rasterize'; svg: string }
	| { type: 'stage'; stage: Stage; percent?:number }
	| { type: 'analyzed'; analysis: Analysis }
	| { type: 'converted'; result: ConversionResult }
	| { type: 'error'; message: string };
