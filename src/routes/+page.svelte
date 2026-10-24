<script lang="ts">
	import { onMount, tick } from 'svelte';
	import MorphSurface from '#lib/MorphSurface.svelte';
	import Icon from '#lib/Icon.svelte';
	import IconButton from '#lib/IconButton.svelte';
	import { Converter } from '#lib/converter.svelte.ts';
	import { formatBytes } from '#lib/machine.ts';
	import { formatById } from '#lib/registry.ts';
	import { stageLabels } from '#lib/engine.ts';
	import { sampleRates, audioBitrates } from '#lib/audio-formats.ts';

	const converter = new Converter();
	const thumbnail = $derived(converter.state.analysis?.preview ?? null);
	let input: HTMLInputElement;
	let dragDepth = $state(0);
	let preview = $state('');
	let previewFailed = $state(false);
	let settingsOpen = $state(false);
	let adding = false;
	let ready = $state(false);

	onMount(() => {
		ready = true;
		return () => converter.destroy();
	});

	$effect(() => {
		const image = thumbnail;
		previewFailed = false;
		// Only display the bounded, worker-decoded thumbnail, never the unvalidated source.
		const url = image ? URL.createObjectURL(image) : '';
		preview = url;
		return () => { if (url) URL.revokeObjectURL(url); };
	});

	function accept(files: FileList | File[] | null) {
		if (!files?.length) return;
		if (converter.state.phase === 'progress') return;
		const previous = converter.state;
		const selected = adding && previous.file ? [...(previous.files ?? [previous.file]), ...Array.from(files)] : Array.from(files);
		adding = false;
		converter.send({ type: 'LOAD', file: selected[0], ...(selected.length > 1 ? { files: selected } : {}) });
	}

	function pickFiles(append = false) {
		adding = append;
		input.click();
	}

	async function removeFile(index: number) {
		const files = (converter.state.files ?? []).filter((_, i) => i !== index);
		if (!files.length) converter.send({ type: 'RESET' });
		else converter.send({ type: 'LOAD', file: files[0], ...(files.length > 1 ? { files } : {}) });
		await tick();
		document.querySelector<HTMLElement>('[data-focus]')?.focus({ preventScroll: true });
	}

	function start(retry = false) {
		converter.send({ type: retry ? 'RETRY' : 'START' });
	}

	function hasFiles(event: DragEvent) { return event.dataTransfer?.types.includes('Files'); }
	function drop(event: DragEvent) {
		if (!hasFiles(event)) return;
		event.preventDefault();
		dragDepth = 0;
		adding = false;
		accept(event.dataTransfer?.files ?? null);
	}
	function paste(event: ClipboardEvent) {
		if (!event.clipboardData?.files.length) return;
		event.preventDefault();
		adding = false;
		accept(event.clipboardData.files);
	}
</script>

<svelte:head>
	<title>Convert — Local file converter</title>
	<meta name="description" content="Convert images, audio and ZIP, TAR or GZIP archives locally. Your files stay in your browser." />
</svelte:head>

<svelte:window onpaste={paste} ondrop={drop}
	ondragenter={(event) => { if (hasFiles(event)) { event.preventDefault(); dragDepth++; } }}
	ondragleave={(event) => { if (hasFiles(event)) dragDepth = Math.max(0, dragDepth - 1); }}
	ondragover={(event) => { if (hasFiles(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = converter.state.phase === 'progress' ? 'none' : 'copy'; } }}
	onblur={() => { dragDepth = 0; }} />

<main class="app" data-ready={ready}>
	<header class="brand">
		<Icon name="swap_horiz" size={18} />
		<h1>Convert</h1>
		<a href="https://mzww.net">mzww.net</a>
	</header>

	<input bind:this={input} class="file-input" type="file" multiple tabindex="-1" aria-label="Choose file"
		onchange={() => { accept(input.files); input.value = ''; }} oncancel={() => { adding = false; }} />

	<section class="workspace" aria-label="File converter">
		<MorphSurface state={converter.state} dragging={dragDepth > 0 && converter.state.phase !== 'progress'}>
			{#snippet children(view)}
				{#if view.phase === 'upload'}
					<button class="drop-area" aria-label="Drop file" disabled={!ready} onclick={() => pickFiles()} data-focus>
						<Icon name="note_add" size={40} />
						<span>Drop files or click to choose</span>
					</button>
				{:else if view.phase === 'details'}
					<div class="details panel">
						<div class="file-row">
							<Icon name={view.analysis?.info.category === 'audio' ? 'audio_file' : view.analysis?.info.category === 'archive' ? 'folder_zip' : view.analysis ? 'image' : 'draft'} size={24} />
							<div class="file-information">
								<h2 class="filename" title={view.file?.name} tabindex="-1" data-focus>{view.files?.length ? `${view.files.length} files` : view.file?.name}</h2>
								<p class="meta">{view.analysis?.info.format || (view.analysisError ? 'Unverified format' : 'Checking format…')} <span aria-hidden="true">·</span> {formatBytes(view.files?.reduce((total, file) => total + file.size, 0) ?? view.file?.size ?? 0)}{#if !view.files?.length && view.analysis?.info.category === 'audio'} · {view.analysis.info.sampleRate} Hz · {view.analysis.info.channels === 1 ? 'Mono' : 'Stereo'}{:else if view.analysis?.info.category === 'archive'} · {view.analysis.info.entries} entries{/if}</p>
							</div>
							<IconButton icon="close" label={view.files?.length ? 'Remove all files' : 'Remove file'} below onclick={() => converter.send({ type: 'RESET' })} />
						</div>

						{#if view.files?.length}
							<ul class="batch-list" aria-label="Selected files">
								{#each view.files as file, i}
									<li><Icon name={view.analysis?.info.category === 'audio' ? 'audio_file' : 'draft'} /><span class="batch-name" title={file.name}>{file.name}</span><span class="meta">{formatBytes(file.size)}</span><IconButton icon="close" label={`Remove ${file.name}`} tooltip="Remove file" below onclick={() => removeFile(i)} /></li>
								{/each}
							</ul>
							<p class="notice" role="status">{view.analysis?.info.category === 'audio' ? `${view.files.length} files → ZIP` : 'Only the first file will be converted. Remove it to use the next file.'}</p>
						{/if}

						{#if preview && !previewFailed}
							<div class="preview">
								<img src={preview} alt="Selected file preview" decoding="async" onerror={() => { previewFailed = true; }} />
								{#if view.analysis?.info.width && view.analysis.info.height}<span class="image-size">{view.analysis.info.width} × {view.analysis.info.height}</span>{/if}
							</div>
						{:else if previewFailed}
							<p class="preview-note" role="status">Preview unavailable. Your image can still be converted.</p>
						{/if}

						<div class="output-row">
							<label class="field output-field"><span class="sr-only">Output format</span>
								<select disabled={!view.analysis} value={view.format} onchange={(event) => converter.send({ type: 'FORMAT', format: event.currentTarget.value })}>
									{#if !view.analysis}<option value="">{view.analysisError ? 'Unavailable' : 'Checking…'}</option>{/if}
									{#each view.analysis?.outputs ?? [] as format}<option value={format}>{format === 'OGG' ? 'OGG Vorbis' : format === 'M4A' ? 'M4A (AAC)' : format}</option>{/each}
								</select>
							</label>
							<IconButton icon="settings" label="Settings" expanded={settingsOpen} controls="advanced-settings" onclick={() => { settingsOpen = !settingsOpen; }} />
							<button class="primary" disabled={!view.analysis} aria-describedby="conversion-note" onclick={() => start()}>Convert <Icon name="arrow_forward" size={18} /></button>
						</div>
						<div id="advanced-settings">
						{#if settingsOpen}
						<div class="settings">
							{#if view.analysis?.info.category === 'audio'}
								<label class="field">Sample rate
									<select value={view.audio.sampleRate} onchange={(event)=>converter.send({type:'AUDIO',sampleRate:+event.currentTarget.value})}>
										<option value={0}>{view.format === 'OPUS' ? '48000 Hz (Opus)' : view.format === 'MP3' ? 'Original / compatible' : 'Original'}</option>
										{#each sampleRates.filter(rate=>view.format === 'OPUS' ? rate===48000 : view.format === 'MP3' ? rate<=48000 : true) as rate}<option value={rate}>{rate} Hz</option>{/each}
									</select>
								</label>
								<label class="field">Channels
									<select value={view.audio.channels} onchange={(event)=>converter.send({type:'AUDIO',channels:+event.currentTarget.value})}>
										<option value={0}>Original</option><option value={1}>Mono</option><option value={2}>Stereo</option>
									</select>
								</label>
								{#if ['MP3','OGG'].includes(view.format)}
									<label class="field">Encoding mode
										<select value={view.audio.mode ?? 'bitrate'} onchange={(event)=>converter.send({type:'AUDIO',mode:event.currentTarget.value as 'bitrate'|'quality'})}>
											<option value="bitrate">Bitrate</option><option value="quality">Quality (VBR)</option>
										</select>
									</label>
								{/if}
								{#if ['MP3','OGG'].includes(view.format) && view.audio.mode === 'quality'}
									<label class="field quality">Quality <span class="quality-value">{view.quality}%</span>
										<input type="range" min="1" max="100" value={view.quality} oninput={(event)=>converter.send({type:'QUALITY',quality:+event.currentTarget.value})} />
									</label>
								{:else if !['WAV','AIFF','FLAC'].includes(view.format)}
									<label class="field">Bitrate
										<select value={view.audio.bitrate ?? 192} onchange={(event)=>converter.send({type:'AUDIO',bitrate:+event.currentTarget.value})}>
											{#each audioBitrates(view.format,view.audio.sampleRate||view.analysis?.info.sampleRate||48000) as bitrate}<option value={bitrate}>{bitrate} kbps</option>{/each}
										</select>
									</label>
								{:else}<div class="field format-note">Encoding<span>{view.format === 'FLAC' ? '16-bit FLAC' : '16-bit PCM'}</span></div>{/if}
							{:else if view.analysis?.info.category === 'archive'}
								{#if view.format === 'ZIP'}
									<label class="field">Compression
										<select value={view.archive.compression} onchange={(event)=>converter.send({type:'ARCHIVE',compression:event.currentTarget.value as 'store'|'deflate'})}>
											<option value="deflate">Deflate (if available)</option><option value="store">Store (no compression)</option>
										</select>
									</label>
								{:else}<div class="field format-note">Compression<span>{view.format === 'TAR' ? 'None' : 'Browser default'}</span></div>{/if}
							{:else if formatById(view.format)?.quality}
								<label class="field quality">Quality <span class="quality-value">{view.quality}%</span>
									<input type="range" min="1" max="100" value={view.quality} oninput={(event) => converter.send({ type: 'QUALITY', quality: +event.currentTarget.value })} />
								</label>
							{:else}
								<div class="field format-note">Settings<span>{view.analysis ? 'Lossless' : '—'}</span></div>
							{/if}
							{#if view.analysis?.info.frames}
								<label class="field">Source frame
									<select value={view.frame} onchange={(event) => converter.send({type:'FRAME',frame:+event.currentTarget.value})}>
										{#each view.analysis.info.frames as frame, i}<option value={i}>{frame.width} × {frame.height} · {i + 1}</option>{/each}
									</select>
								</label>
							{/if}
						</div>
						<a class="license-link" href={`${import.meta.env.BASE_URL}legal/NOTICE.txt`}>Codecs &amp; licenses</a>
						{/if}
						</div>
						{#each view.analysis?.warnings ?? [] as warning}<p class="engine-note" role="status">{warning}</p>{/each}
						<p class="engine-note" class:sr-only={!view.analysisError && !!view.analysis && !settingsOpen && !view.analysis.info.category && !['TIFF', 'ICO', 'AVIF'].includes(view.analysis.info.format) && !['JPEG', 'ICO'].includes(view.format)} id="conversion-note" role="status">{view.analysisError || (!view.analysis ? 'Checking file…' : view.analysis.info.category === 'audio' ? view.format === 'OPUS' ? 'Target bitrate. Ogg Opus uses 48000 Hz. Metadata is removed.' : ['AAC','M4A'].includes(view.format) ? 'Native AAC-LC with target bitrate (may use VBR). Metadata is removed; padding may affect duration.' : ['WAV','AIFF','FLAC'].includes(view.format) ? '16-bit output. Metadata is removed; resampling can affect quality.' : 'Converted locally. Metadata is removed. Bitrate is a target; lossy encoding can affect quality.' : view.analysis.info.category === 'archive' ? view.format === 'GZIP' ? 'Single file only. Folders and original filename are not stored.' : 'Paths and file times kept where possible. Links and unsafe archives are rejected.' : view.analysis.info.format === 'TIFF' ? 'Single-page 8/16-bit grayscale or RGB/RGBA; uncompressed or PackBits. Converted to 8-bit; metadata is removed.' : view.format === 'JPEG' ? 'Transparency is filled with white.' : view.format === 'ICO' ? 'Creates 16, 32, 48 and 256 px icons. Aspect ratio is kept.' : view.analysis.info.format === 'ICO' ? 'Preview shows the largest frame. Converts the selected frame.' : view.analysis.info.format === 'AVIF' ? '8-bit still AVIF only. HDR and color profiles are not preserved.' : 'Converted locally. Your original stays unchanged.')}</p>
						<div class="actions file-actions">
							<div class="tools"><IconButton icon="add" label="Add files" onclick={() => pickFiles(true)} /><IconButton icon="swap_horiz" label="Change file" onclick={() => pickFiles()} /></div>
							{#if view.analysisError}<button class="text-button" onclick={() => converter.send({ type: 'ANALYZE' })}>Try again</button>{/if}
						</div>
					</div>
				{:else if view.phase === 'progress'}
					<div class="panel progress-panel">
						<div class="status-row"><h2 tabindex="-1" data-focus>{stageLabels[view.stage]}</h2>{#if view.progress !== null}<span class="percentage" aria-hidden="true">{view.progress}%</span>{/if}</div>
						<div class="progress-track" role="progressbar" aria-label="Conversion progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={view.progress ?? undefined} aria-valuetext={view.progress === null ? stageLabels[view.stage] : undefined}>
							<div class="progress-fill" class:indeterminate={view.progress === null} style:transform={view.progress === null ? undefined : `scaleX(${view.progress / 100})`}></div>
						</div>
						<div class="progress-bottom"><p class="filename">{view.file?.name}</p><IconButton icon="close" label="Cancel" onclick={() => converter.send({ type: 'CANCEL' })} /></div>
					</div>
				{:else if view.phase === 'complete'}
					<div class="panel result-panel">
						<div class="status-row"><h2 class="success" tabindex="-1" data-focus aria-label="Complete"><Icon name="check_circle" size={24} /><span class="sr-only">Complete</span></h2><IconButton icon="download" label="Download" primary below onclick={() => converter.download()} /></div>
						<div class="result-file"><p class="filename" title={view.result?.name}>{view.result?.name}</p><p class="meta">{view.files?.length && view.analysis?.info.category === 'audio' ? `${view.files.length} files · ZIP` : view.format} <span aria-hidden="true">·</span> {formatBytes(view.result?.blob.size ?? 0)}{#if view.result?.width && view.result.height} · {view.result.width} × {view.result.height}{/if}</p></div>
						<p class="engine-note">{view.analysis?.info.category === 'archive' ? 'Some archive metadata is not retained.' : 'Metadata removed.'}</p>
						<div class="result-actions"><IconButton icon="refresh" label="Convert Again" onclick={() => converter.send({ type: 'AGAIN' })} /><IconButton icon="note_add" label="New File" onclick={() => converter.send({ type: 'RESET' })} /></div>
					</div>
				{:else}
					<div class="panel result-panel">
						<h2 class="error-heading" tabindex="-1" data-focus><Icon name="error" />Conversion failed</h2>
						<p class="error-message">{view.error}</p>
						<div class="actions"><IconButton icon="arrow_back" label="Back to details" onclick={() => converter.send({ type: 'AGAIN' })} /><button class="primary" onclick={() => start(true)}>Try again</button></div>
					</div>
				{/if}
			{/snippet}
		</MorphSurface>
	</section>

	<p class="sr-only" role="status" aria-live="polite">{converter.state.phase === 'progress' ? 'Conversion started. Your original stays unchanged.' : converter.state.phase === 'complete' ? 'Conversion complete. Your file is ready to download.' : converter.state.phase === 'error' ? converter.state.error : ''}</p>
</main>
