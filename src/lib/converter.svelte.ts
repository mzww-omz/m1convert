import { initialState, transition, type Event, type State } from './machine';
import { demoEngine, type ConversionEngine } from './engine';

export class Converter {
	state: State = $state({ ...initialState });
	private controller: AbortController | undefined;
	demoFailure = false;
	private engine: ConversionEngine;

	constructor(engine: ConversionEngine = demoEngine) {
		this.engine = engine;
	}

	send(event: Event) {
		const previous = this.state;
		const next = transition(previous, event);
		if (next === previous) return;
		this.state = next;
		if (previous.phase === 'progress' && (next.phase !== 'progress' || next.runId !== previous.runId)) this.controller?.abort();
		if (next.phase === 'progress' && next.runId !== previous.runId) void this.run(next);
	}

	private async run(state: State) {
		if (!state.file) return;
		const controller = this.controller = new AbortController();
		try {
			await this.engine.run({ file: state.file, format: state.format, quality: state.quality }, controller.signal,
				progress => this.send({ type: 'TICK', runId: state.runId, progress }));
			if (controller.signal.aborted) return;
			if (this.demoFailure) {
				this.demoFailure = false;
				throw new Error('Demo interrupted. Your file is unchanged. Try again.');
			}
			this.send({ type: 'DONE', runId: state.runId });
		} catch (error) {
			if (!controller.signal.aborted) this.send({ type: 'FAIL', runId: state.runId, message: error instanceof Error ? error.message : 'Demo could not finish. Try again.' });
		}
	}

	destroy() { this.controller?.abort(); }
}
