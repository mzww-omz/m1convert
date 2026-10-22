export type Stage = 'reading' | 'decoding' | 'encoding' | 'verifying';
export interface Progress { stage: Stage; percent: number | null }
export const stageLabels: Record<Stage, string> = {
	reading: 'Reading file', decoding: 'Decoding file', encoding: 'Encoding file', verifying: 'Checking output'
};
export interface AudioSettings { sampleRate:number; channels:number; bitrate?:number; mode?:'bitrate'|'quality' }
export interface ArchiveSettings { compression:'store'|'deflate' }
export interface ConversionRequest { file: File; format: string; quality: number; frame?: number; audio?:AudioSettings; archive?:ArchiveSettings; files?:File[] }
export interface ConversionResult {
	blob: Blob;
	name: string;
	format: string;
	mime: string;
	width?: number;
	height?: number;
}
export interface AssetInfo { format: string; mime: string; width?: number; height?: number; frames?: {width:number;height:number}[]; frame?:number; category?:'audio'|'archive'; entries?:number; sampleRate?:number; channels?:number; duration?:number; codec?:string }
export interface Analysis { info: AssetInfo; outputs: string[]; preview: Blob | null }
export type StageReporter=(stage:Stage,percent?:number)=>void;
export interface EngineAdapter {
	inspect(file: File, stage: StageReporter, verifiedOutputs?:readonly string[]): Promise<Analysis>;
	run(request: ConversionRequest, stage: StageReporter): Promise<ConversionResult>;
}
export interface ConversionEngine {
	inspect(file: File, signal: AbortSignal): Promise<Analysis>;
	run(request: ConversionRequest, signal: AbortSignal, onProgress: (progress: Progress) => void): Promise<ConversionResult>;
}
export type VerifiedOutputs = Partial<Record<'image'|'audio',string[]>>;
export type WorkerRequest = { type: 'inspect'; file: File; verifiedOutputs?:VerifiedOutputs } | { type: 'convert'; request: ConversionRequest };
export type WorkerReply =
	| { type: 'rasterize'; svg: string }
	| { type: 'stage'; stage: Stage; percent?:number }
	| { type: 'analyzed'; analysis: Analysis }
	| { type: 'converted'; result: ConversionResult }
	| { type: 'error'; message: string };
