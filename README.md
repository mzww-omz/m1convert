# Convert

Minimal appearance, fluid interaction. A fully client-side PNG / JPEG / WebP converter built on Svelte 5, TypeScript, SvelteKit and Vite. Files never leave the browser. No conversion service, CDN, telemetry or added runtime dependency.

## Supported conversions

| Input → Output | PNG | JPEG | WebP |
| --- | --- | --- | --- |
| PNG | Yes | Yes | Yes |
| JPEG | Yes | Yes | Yes |
| WebP | Yes | Yes | Yes |

Same-format re-encoding is supported. Output choices are restricted to encoders actually verified in the current browser: an encoder silently falling back to PNG is not treated as support.

- PNG and WebP retain transparency. JPEG composites transparency onto **white**.
- JPEG / WebP expose quality from 1–100.
- Dimensions are retained in display orientation. EXIF orientations 1–8 are normalized once, including mirrored images; the output does not retain the original EXIF orientation/GPS or other source metadata.
- AVIF, GIF, SVG, animated PNG/WebP, audio, video and documents are **not supported**. Animated images are rejected rather than silently flattened.
- Browser Canvas uses its native color conversion and an 8-bit RGBA pipeline. This is not an archival, 16-bit/HDR, color-profile-preserving or metadata-preserving converter.

## Run and use

```sh
npm run dev
```

Select, drop or paste one image, choose the output and Convert. Download saves the real encoded Blob with a matching MIME type and extension. Convert Again and Cancel retain the source and settings. New File/Remove clear state and revoke associated Blob URLs. Change file cancels pending analysis. Multiple-file drops select the first file and say so; during conversion, cancel before replacing the input.

Analysis shows filename/size immediately and fills in validated metadata, a bounded thumbnail and available outputs asynchronously. Invalid files remain in Details with a clear explanation, Try again, Change file and Remove. Conversion failures use the same surface with retry.

Progress displays actual processing stages. Native image decode/encode APIs do not expose measurable progress, so they use an **indeterminate** bar, not fabricated percentages. Very short conversions may finish before a progress transition becomes visible; no artificial delay is added. There is no production demo mode or demo URL parameter.

## Browser requirements

Requires module Workers, worker-side `createImageBitmap`, `OffscreenCanvas` with a 2D context, and `convertToBlob`. Local Chromium has been verified; other browser engines/versions need independent testing. Missing worker/decoder support produces an error, never a blocking main-thread fallback. Encoder capability is tested in a worker on file analysis and output MIME/signature and re-decodability are checked for every conversion.

## Safety and resource limits

- Encoded input: **32 MiB**; output: **64 MiB**.
- Dimensions: **8192 pixels per side**, at most **16 million pixels**.
- Estimated working buffers: at most **256 MiB** (`12 × pixels + 2 × input bytes`). Native browser decoder/encoder internals are not a hard OS memory sandbox; real peak process memory can exceed this estimate.
- One active worker per converter. Each analysis/conversion has a **30-second** deadline. Cancel, replacement, reset, errors and deadlines terminate the worker. Late callbacks are ignored by both the scheduler and state machine.
- Signatures and bounded structural headers are checked before decoding. Conflicting extensions/MIME, invalid dimensions, truncated structures, malformed EXIF offsets, unsupported animation and native decoding failures are rejected. Empty MIME or `application/octet-stream` and extensionless files are accepted only when contents identify a supported image.
- Only a validated, worker-generated thumbnail (max 320 × 180) reaches the UI preview. Raw files are never rendered as HTML/SVG or read/parsed synchronously on the main thread.
- Source files are immutable, held in memory and never sent to a server or written to browser storage. The explicit Download action is the only output save. Object URLs, bitmaps and canvases are released on completion/replacement/reset/destruction; terminating a worker releases its job resources.

## Architecture and extension

| Responsibility | File |
| --- | --- |
| Format definitions and signature matchers | `src/lib/formats.ts` |
| Format / conversion registries and planner | `src/lib/registry.ts` |
| Pre-decode image structure, EXIF and budget checks | `src/lib/image-format.ts` |
| Lazy native image adapter | `src/lib/adapters/canvas-codec.ts` |
| Adapter selection and worker protocol | `src/lib/conversion.worker.ts`, `engine-types.ts` |
| Scheduling, abort/timeout/worker cleanup | `src/lib/scheduler.ts`, `engine.ts` |
| State machine and asynchronous lifecycle | `src/lib/machine.ts`, `converter.svelte.ts` |
| Result Blob URLs, filenames and downloads | `src/lib/results.ts` |
| Existing persistent animated frame | `src/lib/MorphSurface.svelte` (unchanged) |

To add an engine:

1. Implement `EngineAdapter.inspect(file, stage)` and `run(request, stage)` in a new adapter module. Analysis returns detected format/MIME, actual supported output IDs and an optional safe thumbnail. Dimensions are optional in the shared contract; image adapters return them. Keep validation, format-specific limits, capability probes, accurate progress and result verification in the adapter.
2. Add a lightweight `AdapterDefinition` to `adapters` in `registry.ts`: `id`, contributed `formats` (ID, MIME, extension aliases, quality support and signature matcher), `inputs`, `outputs`, and `load: async () => (await import('./adapters/new-codec.ts')).adapter`.
3. The format list and direct routes derive from those registrations automatically. The worker chooses the adapter and imports its implementation only when needed. Vite's ES-module worker output preserves lazy codec chunks. Do not import heavy codec implementations in the page.
4. Add real fixtures and positive/negative/cancellation tests before advertising the new routes. Add UI settings only when that format requires them.

The planner currently returns one direct step. Its steps-list contract allows later multi-hop planning, but no unimplemented intermediary route or codec is advertised or executed. A queue/framework/plugin loader is intentionally not introduced for a single-file tool.

## Verification

Node 22.18+ is needed for native TypeScript stripping in unit tests. All test toolchain packages are already present in the repository dependencies.

```sh
npm test
npm run check
npm run build
```

With the local server running and an existing Playwright + Chromium installation:

```sh
npm run test:browser
```

For an installation outside this repository:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
PLAYWRIGHT_EXECUTABLE_PATH=/absolute/path/to/chromium \
TEST_URL=http://localhost:5173 \
npm run test:browser
```

No browser/package is downloaded automatically. For production verification, build first, start `npm run preview -- --port 4174 --strictPort`, and set `TEST_URL` accordingly.

The browser suite exercises all nine real conversions, downloaded-file bytes and decoding, dimensions/transparency/JPEG background, both quality controls, all eight EXIF orientations, unsupported encoders, validation/errors/retry, high-entropy 16-megapixel cancellation, worker/URL cleanup, input methods, rapid operations, focus, reduced motion, touch emulation, 320px/tablet/resizing and actual frame geometry/timing. Fixtures in `tests/fixtures/` contain opaque, semi-transparent and transparent regions. Controller unit tests compile the real runes module with the existing Svelte/TypeScript toolchain.

Screenshots, an actual downloaded JPEG and measured frame intervals are written to ignored `artifacts/phase1/`. Results and unverified environments are recorded in [`docs/QA.md`](docs/QA.md). Physical mobile devices, OS clipboard integration, screen readers, Safari and Firefox still require manual verification.
