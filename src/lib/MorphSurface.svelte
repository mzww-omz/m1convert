<script lang="ts">
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import type { State } from './machine';

	let { state: model, dragging = false, children }: { state: State; dragging?: boolean; children: Snippet<[State]> } = $props();
	let displayed = $state<State>(untrack(() => model));
	let hidden = $state(false);
	let height = $state(240);
	let viewport = $state(1024);
	let reduced = false;
	let targetPhase = untrack(() => model.phase);
	let generation = 0;
	let switching = false;
	let content: HTMLDivElement;
	const widths = { upload: 240, details: 440, progress: 360, complete: 360, error: 400 };
	let width = $derived(Math.min(widths[displayed.phase], viewport - 40));
	const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

	onMount(() => {
		viewport = window.innerWidth;
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		const motion = () => { reduced = media.matches; };
		motion();
		media.addEventListener('change', motion);
		const observer = new ResizeObserver(() => { height = content.getBoundingClientRect().height; });
		observer.observe(content);
		return () => { generation++; observer.disconnect(); media.removeEventListener('change', motion); };
	});

	$effect(() => {
		const current = model;
		untrack(() => {
			if (current.phase !== targetPhase) {
				targetPhase = current.phase;
				void morph();
			} else if (!switching) displayed = current;
		});
	});

	async function morph() {
		const id = ++generation;
		switching = true;
		hidden = true;
		if (!reduced) await pause(100);
		if (id !== generation) return;
		displayed = model;
		await tick();
		height = content.getBoundingClientRect().height;
		if (!reduced) await pause(120);
		if (id !== generation) return;
		displayed = model;
		hidden = false;
		switching = false;
		await tick();
		content.querySelector<HTMLElement>('[data-focus]')?.focus({ preventScroll: true });
	}
</script>

<svelte:window onresize={() => { viewport = window.innerWidth; }} />

<div class="surface" class:dragging data-surface data-phase={displayed.phase}
	style:width="{width}px" style:height="{height}px">
	<div bind:this={content} class="surface-content" class:hidden inert={hidden}
		style:width="{width}px">
		{@render children(displayed)}
	</div>
</div>

<style>
	.surface {
		position: relative;
		flex: none;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: #fff;
		overflow: clip;
		box-sizing: content-box;
		transition: width 320ms var(--ease), height 320ms var(--ease), border-color 160ms, background-color 160ms;
	}
	.surface.dragging { border-color: var(--ink); background: #f7f7f7; }
	.surface-content { position: absolute; inset: 0 auto auto 0; opacity: 1; transition: opacity 180ms ease; }
	.surface-content.hidden { opacity: 0; transition-duration: 100ms; }
	@media (prefers-reduced-motion: reduce) {
		.surface, .surface-content { transition: none; }
	}
</style>
