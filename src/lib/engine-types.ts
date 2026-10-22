export type Stage = 'reading' | 'decoding' | 'encoding' | 'verifying';
export interface Progress { stage: Stage; percent: number | null }
export const stageLabels: Record<Stage, string> = {
	reading: 'Reading image', decoding: 'Decoding image', encoding: 'Encoding image', verifying: 'Checking output'
};
export interface AudioSettings { sampleRate:number; channels:number }
export interface ArchiveSettings { compression:'store'|'deflate' }
export interface ConversionRequest { file: File; format: string; quality: number; frame?: number; audio?:AudioSettings; archive?:ArchiveSettings }
export interface ConversionResult {
	blob: Blob;
	name: string;
	format: string;
	mime: string;
	width?: number;
	height?: number;
}
export interface AssetInfo { format: string; mime: string; width?: number; height?: number; frames?: {width:number;height:number}[]; frame?:number; category?:'audio'|'archive'; entries?:number; sampleRate?:number; channels?:number; duration?:number }
export interface Analysis { info: AssetInfo; outputs: string[]; preview: Blob | null }
export interface EngineAdapter {
	inspect(file: File, stage: (stage: Stage) => void): Promise<Analysis>;
	run(request: ConversionRequest, stage: (stage: Stage) => void): Promise<ConversionResult>;
}
export interface ConversionEngine {
	inspect(file: File, signal: AbortSignal): Promise<Analysis>;
	run(request: ConversionRequest, signal: AbortSignal, onProgress: (progress: Progress) => void): Promise<ConversionResult>;
}
export type WorkerRequest = { type: 'inspect'; file: File } | { type: 'convert'; request: ConversionRequest };
export type WorkerReply =
	| { type: 'rasterize'; svg: string }
	| { type: 'stage'; stage: Stage }
	| { type: 'analyzed'; analysis: Analysis }
	| { type: 'converted'; result: ConversionResult }
	| { type: 'error'; message: string };
