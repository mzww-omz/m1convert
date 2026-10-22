import { formatsFor } from './registry.ts';
import type { Analysis, ConversionResult, Stage } from './engine-types.ts';
export { outputName } from './results.ts';

export type Phase = 'upload' | 'details' | 'progress' | 'complete' | 'error';
export interface State {
	phase: Phase;
	file: File | null;
	analysis: Analysis | null;
	analysisError: string;
	format: string;
	quality: number;
	progress: number | null;
	stage: Stage;
	runId: number;
	error: string;
	result: ConversionResult | null;
}
export type Event =
	| { type: 'LOAD'; file: File }
	| { type: 'ANALYZED'; runId: number; analysis: Analysis }
	| { type: 'ANALYSIS_FAILED'; runId: number; message: string }
	| { type: 'FORMAT'; format: string }
	| { type: 'QUALITY'; quality: number }
	| { type: 'START' | 'CANCEL' | 'AGAIN' | 'RESET' | 'RETRY' | 'ANALYZE' }
	| { type: 'TICK'; runId: number; progress: number | null; stage: Stage }
	| { type: 'DONE'; runId: number; result: ConversionResult }
	| { type: 'FAIL'; runId: number; message: string };

export const initialState: State = {
	phase: 'upload', file: null, analysis: null, analysisError: '', format: '', quality: 90,
	progress: null, stage: 'reading', runId: 0, error: '', result: null
};

export function transition(state: State, event: Event): State {
	if (event.type === 'RESET') return { ...initialState, runId: state.runId + 1 };
	if (event.type === 'LOAD') return { ...initialState, phase: 'details', file: event.file, runId: state.runId + 1 };
	if ('runId' in event && event.runId !== state.runId) return state;
	if (event.type === 'ANALYZED' || event.type === 'ANALYSIS_FAILED') {
		if (state.phase !== 'details' || state.analysis || state.analysisError) return state;
		if (event.type === 'ANALYSIS_FAILED') return { ...state, analysisError: event.message };
		const outputs = formatsFor(event.analysis.info.format, event.analysis.outputs);
		if (!outputs.length) return { ...state, analysisError: 'No supported image encoders are available in this browser.' };
		return { ...state, analysis: { ...event.analysis, outputs }, format: outputs.includes('WEBP') ? 'WEBP' : outputs[0] };
	}
	if ('runId' in event && state.phase !== 'progress') return state;
	switch (event.type) {
		case 'ANALYZE':
			return state.phase === 'details' && state.file ? { ...state, analysis: null, analysisError: '', format: '', runId: state.runId + 1 } : state;
		case 'FORMAT':
			return state.phase === 'details' && state.analysis?.outputs.includes(event.format) ? { ...state, format: event.format } : state;
		case 'QUALITY':
			return state.phase === 'details' && Number.isFinite(event.quality) ? { ...state, quality: Math.max(1, Math.min(100, event.quality)) } : state;
		case 'START':
		case 'RETRY':
			return state.file && state.analysis?.outputs.includes(state.format) && state.phase === (event.type === 'START' ? 'details' : 'error')
				? { ...state, phase: 'progress', progress: null, stage: 'reading', error: '', result: null, runId: state.runId + 1 } : state;
		case 'TICK':
			return event.progress === null || Number.isFinite(event.progress)
				? { ...state, stage: event.stage, progress: event.progress === null ? null : Math.max(state.progress ?? 0, Math.min(99, event.progress)) } : state;
		case 'DONE': return { ...state, phase: 'complete', progress: 100, result: event.result };
		case 'FAIL': return { ...state, phase: 'error', error: event.message, result: null };
		case 'CANCEL':
			return state.phase === 'progress' ? { ...state, phase: 'details', progress: null, runId: state.runId + 1 } : state;
		case 'AGAIN':
			return state.phase === 'complete' || state.phase === 'error' ? { ...state, phase: 'details', error: '', result: null } : state;
	}
}

export function formatBytes(bytes: number): string {
	if (!bytes) return '0 B';
	const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
	return `${Number((bytes / 1024 ** unit).toFixed(1))} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}
