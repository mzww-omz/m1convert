export type Phase = 'upload' | 'details' | 'progress' | 'complete' | 'error';
export interface State {
	phase: Phase;
	file: File | null;
	format: string;
	quality: number;
	progress: number;
	runId: number;
	error: string;
}
export type Event =
	| { type: 'LOAD'; file: File }
	| { type: 'FORMAT'; format: string }
	| { type: 'QUALITY'; quality: number }
	| { type: 'START' | 'CANCEL' | 'AGAIN' | 'RESET' | 'RETRY' }
	| { type: 'TICK'; runId: number; progress: number }
	| { type: 'DONE'; runId: number }
	| { type: 'FAIL'; runId: number; message: string };

export const initialState: State = {
	phase: 'upload', file: null, format: '', quality: 90, progress: 0, runId: 0, error: ''
};

// These are UI examples, not claims of conversion-engine support.
export function formatsFor(file: File): string[] {
	const extension = file.name.split('.').pop()?.toLowerCase();
	if (file.type.startsWith('image/') || /^(png|jpe?g|webp|gif|avif|svg|heic)$/.test(extension ?? '')) return ['WEBP', 'PNG', 'JPG', 'AVIF'];
	if (file.type.startsWith('audio/')) return ['MP3', 'WAV', 'FLAC', 'OGG'];
	if (file.type.startsWith('video/')) return ['MP4', 'WEBM', 'GIF'];
	if (file.type.startsWith('text/') || /^(pdf|docx?|md|txt|csv)$/.test(extension ?? '')) return ['PDF', 'TXT', 'HTML'];
	return ['ZIP'];
}

export function transition(state: State, event: Event): State {
	if (event.type === 'RESET') return { ...initialState, runId: state.runId + 1 };
	if (event.type === 'LOAD') return { ...initialState, phase: 'details', file: event.file, format: formatsFor(event.file)[0], runId: state.runId + 1 };
	if ('runId' in event && (state.phase !== 'progress' || event.runId !== state.runId)) return state;
	switch (event.type) {
		case 'FORMAT':
			return state.phase === 'details' && state.file && formatsFor(state.file).includes(event.format) ? { ...state, format: event.format } : state;
		case 'QUALITY':
			return state.phase === 'details' && Number.isFinite(event.quality) ? { ...state, quality: Math.max(1, Math.min(100, event.quality)) } : state;
		case 'START':
		case 'RETRY':
			return state.file && state.phase === (event.type === 'START' ? 'details' : 'error') ? { ...state, phase: 'progress', progress: 0, error: '', runId: state.runId + 1 } : state;
		case 'TICK':
			return Number.isFinite(event.progress) ? { ...state, progress: Math.max(state.progress, Math.min(99, event.progress)) } : state;
		case 'DONE': return { ...state, phase: 'complete', progress: 100 };
		case 'FAIL': return { ...state, phase: 'error', error: event.message };
		case 'CANCEL':
			return state.phase === 'progress' ? { ...state, phase: 'details', progress: 0, runId: state.runId + 1 } : state;
		case 'AGAIN':
			return state.phase === 'complete' || state.phase === 'error' ? { ...state, phase: 'details', error: '' } : state;
	}
}

export function formatBytes(bytes: number): string {
	if (!bytes) return '0 B';
	const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
	return `${Number((bytes / 1024 ** unit).toFixed(1))} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}

export function outputName(name: string, format: string): string {
	return `${name.replace(/\.[^.]+$/, '') || name}.${format.toLowerCase()}`;
}
