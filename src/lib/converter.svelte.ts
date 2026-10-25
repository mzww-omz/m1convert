import { initialState, transition, type Event, type State } from './machine';
import { imageEngine, type ConversionEngine } from './engine';
import { ResultManager, discardResult } from './results';

export class Converter {
	state: State = $state({ ...initialState });
	private controller: AbortController | undefined;
	private results = new ResultManager();
	private destroyed = false;
	private engine: ConversionEngine;

	constructor(engine: ConversionEngine = imageEngine) { this.engine = engine; }

	send(event: Event) {
		if (this.destroyed) return;
		const previous = this.state;
		const next = transition(previous, event);
		if (next === previous) return;
		if (next.result !== previous.result) {
			if (next.result) this.results.set(next.result); else this.results.clear();
		}
		if (next.runId !== previous.runId || (previous.phase === 'progress' && next.phase !== 'progress')) this.controller?.abort();
		this.state = next;
		if (event.type === 'LOAD' || event.type === 'ANALYZE') void this.inspect(next);
		if (next.phase === 'progress' && next.runId !== previous.runId) void this.run(next);
	}

	private async inspect(state: State) {
		if (!state.file) return;
		const controller = this.controller = new AbortController();
		try {
			const analysis = await this.engine.inspect(state.file, controller.signal);
			if (!controller.signal.aborted) this.send({ type: 'ANALYZED', runId: state.runId, analysis });
		} catch (error) {
			if (!controller.signal.aborted) this.send({ type: 'ANALYSIS_FAILED', runId: state.runId, message: this.message(error) });
		}
	}

	private async run(state: State) {
		if (!state.file) return;
		const controller = this.controller = new AbortController();
		try {
			const result = await this.engine.run({ file: state.file, format: state.format, quality: state.quality, ...(state.frame === undefined ? {} : {frame:state.frame}), ...(state.analysis?.info.category==='audio' ? {audio:{...state.audio},files:state.files?Array.from(state.files):undefined} : {}), ...(state.analysis?.info.category==='archive' ? {archive:{...state.archive}} : {}), ...(state.analysis?.info.category==='video' ? {video:{...state.video}} : {}) }, controller.signal,
				progress => this.send({ type: 'TICK', runId: state.runId, progress: progress.percent, stage: progress.stage }));
			if (!controller.signal.aborted) this.send({ type: 'DONE', runId: state.runId, result });
			else discardResult(result);
		} catch (error) {
			if (!controller.signal.aborted) this.send({ type: 'FAIL', runId: state.runId, message: this.message(error) });
		}
	}

	private message(error: unknown) { return error instanceof Error ? error.message : 'File processing failed. Try again.'; }
	download() { if (this.state.phase === 'complete') this.results.download(); }
	destroy() {
		this.send({ type: 'RESET' });
		this.destroyed = true;
		this.controller?.abort();
		this.results.clear();
	}
}
