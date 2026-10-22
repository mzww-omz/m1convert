<script lang="ts">
	import { onMount } from 'svelte';
	import MorphSurface from '#lib/MorphSurface.svelte';
	import { Converter } from '#lib/converter.svelte.ts';
	import { formatBytes, formatsFor, outputName } from '#lib/machine.ts';

	const converter = new Converter();
	const selectedFile = $derived(converter.state.file);
	let input: HTMLInputElement;
	let dragDepth = $state(0);
	let preview = $state('');
	let previewFailed = $state(false);
	let dimensions = $state('');
	let notice = $state('');
	let ready = $state(false);

	onMount(() => {
		converter.demoFailure = new URLSearchParams(location.search).get('demo') === 'error';
		ready = true;
		return () => converter.destroy();
	});

	$effect(() => {
		const file = selectedFile;
		previewFailed = false;
		dimensions = '';
		// Native asynchronous image decoding only; never read an entire file into JS.
		const url = file && /^image\/(png|jpeg|webp|gif|avif)$/.test(file.type) && file.size <= 20 * 1024 ** 2
			? URL.createObjectURL(file) : '';
		preview = url;
		return () => { if (url) URL.revokeObjectURL(url); };
	});

	function accept(files: FileList | File[] | null) {
		if (!files?.length) return;
		if (converter.state.phase === 'progress') return;
		notice = files.length > 1 ? 'One file at a time. The first file was selected.' : '';
		converter.send({ type: 'LOAD', file: files[0] });
	}

	function start(retry = false) {
		converter.send({ type: retry ? 'RETRY' : 'START' });
	}

	function hasFiles(event: DragEvent) { return event.dataTransfer?.types.includes('Files'); }
	function drop(event: DragEvent) {
		if (!hasFiles(event)) return;
		event.preventDefault();
		dragDepth = 0;
		accept(event.dataTransfer?.files ?? null);
	}
	function paste(event: ClipboardEvent) {
		if (!event.clipboardData?.files.length) return;
		event.preventDefault();
		accept(event.clipboardData.files);
	}
</script>

<svelte:head>
	<title>Convert — Local file converter</title>
	<meta name="description" content="A quiet, local-first file converter. Phase 0 interaction demo. Your files stay in your browser." />
</svelte:head>

<svelte:window onpaste={paste} ondrop={drop}
	ondragenter={(event) => { if (hasFiles(event)) { event.preventDefault(); dragDepth++; } }}
	ondragleave={(event) => { if (hasFiles(event)) dragDepth = Math.max(0, dragDepth - 1); }}
	ondragover={(event) => { if (hasFiles(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = converter.state.phase === 'progress' ? 'none' : 'copy'; } }}
	onblur={() => { dragDepth = 0; }} />

<main class="app" data-ready={ready}>
	<header class="brand">
		<svg class="logo" width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
			<path d="M7 11h20l-5-5M27 23H7l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" />
		</svg>
		<h1>Convert</h1>
	</header>

	<input bind:this={input} class="file-input" type="file" tabindex="-1" aria-label="Choose file"
		onchange={() => { accept(input.files); input.value = ''; }} />

	<section class="workspace" aria-label="File converter">
		<MorphSurface state={converter.state} dragging={dragDepth > 0 && converter.state.phase !== 'progress'}>
			{#snippet children(view)}
				{#if view.phase === 'upload'}
					<button class="drop-area" disabled={!ready} onclick={() => input.click()} data-focus>Drop file</button>
				{:else if view.phase === 'details'}
					<div class="details panel">
						<div class="file-row">
							<div class="file-information">
								<h2 class="filename" title={view.file?.name} tabindex="-1" data-focus>{view.file?.name}</h2>
								<p class="meta">{view.file?.type || 'Unknown type'} <span aria-hidden="true">·</span> {formatBytes(view.file?.size ?? 0)}</p>
							</div>
							<button class="text-button remove" aria-label="Remove file" onclick={() => { notice = ''; converter.send({ type: 'RESET' }); }}>Remove</button>
						</div>

						{#if preview && !previewFailed}
							<div class="preview">
								<img src={preview} alt="Selected file preview" decoding="async"
									onload={(event) => { const image = event.currentTarget as HTMLImageElement; dimensions = `${image.naturalWidth} × ${image.naturalHeight}`; }}
									onerror={() => { previewFailed = true; }} />
								{#if dimensions}<span class="image-size">{dimensions}</span>{/if}
							</div>
						{:else if previewFailed}
							<p class="preview-note" role="status">Preview unavailable. You can still explore the demo.</p>
						{/if}

						<div class="settings">
							<label class="field">Output format
								<select value={view.format} onchange={(event) => converter.send({ type: 'FORMAT', format: event.currentTarget.value })}>
									{#each view.file ? formatsFor(view.file) : [] as format}<option value={format}>{format}</option>{/each}
								</select>
							</label>
							{#if ['WEBP', 'JPG', 'AVIF', 'MP3', 'MP4', 'WEBM', 'OGG'].includes(view.format)}
								<label class="field quality">Quality <span class="quality-value">{view.quality}%</span>
									<input type="range" min="1" max="100" value={view.quality} oninput={(event) => converter.send({ type: 'QUALITY', quality: +event.currentTarget.value })} />
								</label>
							{:else}
								<div class="field format-note">{view.format === 'ZIP' ? 'Compression' : 'Settings'}<span>{['PNG', 'WAV', 'FLAC', 'ZIP'].includes(view.format) ? 'Lossless' : 'Default'}</span></div>
							{/if}
						</div>
						<p class="demo-note" id="demo-explanation">Demo mode. No files are converted.</p>
						{#if notice}<p class="notice" role="status">{notice}</p>{/if}
						<div class="actions">
							<button class="text-button" onclick={() => input.click()}>Change file</button>
							<button class="primary" aria-describedby="demo-explanation" onclick={() => start()}>Convert <span aria-hidden="true">→</span></button>
						</div>
					</div>
				{:else if view.phase === 'progress'}
					<div class="panel progress-panel">
						<div class="status-row"><h2 tabindex="-1" data-focus>Running demo</h2><span class="percentage" aria-hidden="true">{view.progress}%</span></div>
						<div class="progress-track" role="progressbar" aria-label="Demo progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={view.progress}>
							<div class="progress-fill" style:transform="scaleX({view.progress / 100})"></div>
						</div>
						<div class="progress-bottom"><p class="demo-note">Your file stays unchanged.</p><button class="text-button" onclick={() => converter.send({ type: 'CANCEL' })}>Cancel</button></div>
					</div>
				{:else if view.phase === 'complete'}
					<div class="panel result-panel">
						<h2 tabindex="-1" data-focus>Demo complete</h2>
						<div class="result-file"><p class="filename" title={outputName(view.file?.name ?? '', view.format)}>{outputName(view.file?.name ?? '', view.format)}</p><p class="meta">{view.format} <span aria-hidden="true">·</span> Preview only · Size unavailable</p></div>
						<button class="primary download" disabled aria-describedby="download-note">Download</button>
						<p class="demo-note" id="download-note">No output file was created in this demo.</p>
						<div class="result-actions"><button class="text-button" onclick={() => converter.send({ type: 'AGAIN' })}>Convert Again</button><button class="text-button" onclick={() => { notice = ''; converter.send({ type: 'RESET' }); }}>New File</button></div>
					</div>
				{:else}
					<div class="panel result-panel">
						<h2 tabindex="-1" data-focus>Demo could not finish</h2>
						<p class="error-message">{view.error}</p>
						<div class="actions"><button class="text-button" onclick={() => converter.send({ type: 'AGAIN' })}>Back to details</button><button class="primary" onclick={() => start(true)}>Try again</button></div>
					</div>
				{/if}
			{/snippet}
		</MorphSurface>
	</section>

	<footer><p>Local convert <span aria-hidden="true">/</span> v1.0.0</p><a href="https://mzww.net">mzww.net</a></footer>
	<p class="sr-only" role="status" aria-live="polite">{converter.state.phase === 'progress' ? 'Demo started. No file will be converted.' : converter.state.phase === 'complete' ? 'Demo complete. No output file was created.' : converter.state.phase === 'error' ? converter.state.error : ''}</p>
</main>
