# Convert

Minimal appearance, fluid interaction. A fully client-side image, audio and archive converter built on Svelte 5, TypeScript, SvelteKit and Vite. Files never leave the browser. No conversion service, CDN or telemetry. Audio WASM is pinned, lazily loaded and self-hosted with license notices and corresponding sources.

## Phase 9 - additional codecs and formats

- **JPEG XL (.jxl):** image input and output using lazy single-thread WASM. PNG -> JXL -> PNG tested in Chromium.
- **HEIC/HEIF:** HEVC-coded single-image input (output PNG/JPEG/WebP/JXL/BMP/ICO/TIFF, subject to verified encoders). Tested with two real HEIC images, including a 3992 x 2992 photograph. HEIC/HEIF output is not implemented.
- **7z, RAR3/RAR5, XZ/TAR.XZ, BZip2/TAR.BZ2, Zstandard/TAR.ZST:** input support. ZIP/TAR/TAR.GZ and conditional single-file GZIP remain the archive outputs. Six fixture variants were converted to ZIP and checked in Chromium.
- All new archive inputs are bounded to 64 MiB compressed and 64 MiB extracted data. Source paths and payloads are validated; filesystem extraction, password decoding and retention of libarchive-only modification dates are not supported.
- Animated images, multi-image HEIF, video and document conversion remain future work.

**The earlier 134-route Phase 8 matrix is a baseline, not the full Phase 9 claim.** Phase 9's larger registry is *not* yet a fully tested all-pairs matrix. See [Phase 9 implementation, licenses, tests and exact limitations](docs/phase-9.md). Run `npm run test:phase9`.

## Supported conversions

### Images (Phase 8 baseline; Phase 9 additions listed above)

| Input → Output | PNG | JPEG | WebP | BMP | ICO | TIFF | AVIF |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PNG / JPEG / WebP | Yes | Yes | Yes | Yes | Yes | Yes | Conditional |
| BMP (24/32-bit) | Yes | Yes | Yes | Yes | Yes | Yes | Conditional |
| ICO (PNG or 24/32-bit DIB) | Yes | Yes | Yes | Yes | Yes | Yes | Conditional |
| AVIF (8-bit still, native decode) | Yes | Yes | Yes | Yes | Yes | Yes | Conditional |
| SVG (safe static subset, input only) | Yes | Yes | Yes | Yes | Yes | Yes | Conditional |
| GIF (single frame, input only) | Yes | Yes | Yes | Yes | Yes | Yes | Conditional |
| TIFF (supported subset below) | Yes | Yes | Yes | Yes | Yes | Yes | Conditional |

Every Yes also requires successful runtime codec probes. Chromium verified **54 image pairs** (9 inputs × 6 outputs), retaining the original 35. AVIF is **input-only in the tested environment**: native Canvas falls back to PNG for AVIF encoding. AVIF output is exposed only if a genuine native encoder passes signature, structure, re-decode and dimension checks. SVG/GIF output, raster-to-vector tracing and embedded-raster pseudo-SVG are unsupported.

Same-format re-encoding is supported. Output choices are restricted to encoders actually verified in the current browser: an encoder silently falling back to PNG is not treated as support.

- PNG, WebP, BMP V4 and ICO retain transparency. JPEG composites transparency onto **white**.
- JPEG / WebP and a verified AVIF encoder expose quality from 1–100.
- Dimensions are retained in display orientation. EXIF orientations 1–8 are normalized once, including mirrored images; the output does not retain the original EXIF orientation/GPS or other source metadata.
- Animated GIF/PNG/WebP/AVIF, video and documents are **not supported**. Animated images are rejected rather than silently flattened.
- Browser Canvas uses its native color conversion and an 8-bit RGBA pipeline. This is not an archival, 16-bit/HDR, color-profile-preserving or metadata-preserving converter.

### Audio and archives (Phase 8 baseline)

| Input | Output | Verified format pairs |
| --- | --- | --- |
| MP3 / PCM WAV / FLAC / OGG Vorbis / Opus / AAC-LC / M4A (AAC) | WAV / AIFF / MP3 / FLAC / OGG Vorbis / Opus / AAC / M4A | 56 |
| Uncompressed AIFF | Same eight audio outputs | 8 |
| ZIP (store/deflate), POSIX USTAR TAR, TAR.GZ, GZIP | ZIP, TAR, TAR.GZ, single-file GZIP | 16 |

**Phase 8 baseline: 134 verified format pairs in Chromium**: 54 image + 64 audio + 16 archive. Phase 6 adds eight AIFF output pairs and expands the accepted TIFF subset; TIFF variants are not counted as new format pairs. All previous 72 paths remain. AAC/M4A require verified native WebCodecs; unsupported browser codecs are hidden. Counts exclude presets and batch packaging; routes depend on browser support and actual file structure. GZIP output needs exactly one regular file; TAR destinations require USTAR-representable names and size. No unsupported codec is advertised.

Audio exposes sample-rate/channel settings, target bitrate and MP3/Vorbis VBR quality. Source metadata (title/artist/cover art/etc.) is removed; newly generated encoder identification and codec delay information may remain. WAV/AIFF/FLAC output is PCM16, not archival precision preservation. Opus uses 48000 Hz; incompatible explicit MP3/Opus UI settings are adjusted visibly on format changes. Multiple supported audio files are converted sequentially with shared settings and downloaded as one real ZIP (32 files / 32 MiB total). ZIP offers Store or Deflate, not fictitious numeric levels. Archives retain bytes, directories and file times where possible; GZIP output drops directory entries and does not store the original filename. No filesystem extraction occurs. All jobs use the existing cancellable worker/deadline lifecycle.

See **[compressed-audio matrix, licensing, payload sizes and limits](docs/compressed-audio.md)** and [archive/image details](docs/continuous-development.md). Compressed audio is capped at **8 million interleaved decoded samples** (about **83 seconds at 48 kHz stereo**); it is a bounded clip converter, not a long-form streaming transcoder. AAC/M4A are native AAC-LC paths, not a bundled AAC WASM fallback. WMA, ALAC, video/multiple audio streams, and fragmented MP4 are not implemented. 7z/RAR/BZIP2/XZ/Zstandard have new **input-only** paths (see Phase 9).

### Extended image format boundaries

- **JPEG XL:** lazy pinned jSquash WASM input/output. Output quality is configurable and the resulting codestream is re-decoded. Segmented, animated and multi-frame JXL are not supported.
- **HEIC/HEIF:** HEVC-coded single still images through lazy libheif WASM. Multi-image sequences and HEIC encoding remain unsupported. LGPL-3.0 and HEVC distribution constraints apply.
- **GIF:** bounded single-frame GIF87a/GIF89a with native decoding. Multiple frames/looping extensions are rejected; there is no GIF encoder or silent flattening.
- **TIFF:** classic little/big-endian, single-page, chunky unsigned 8/16-bit RGB/unassociated-alpha RGBA or WhiteIsZero/BlackIsZero grayscale; uncompressed or PackBits, orientation 1 only. Checks strip sizes/offsets, bounded PackBits runs, directory fields and overlap before pixel allocation. ICC profiles/transfer functions, predictors and reversed fill order are rejected. **16-bit input is rounded to RGBA8**, not preserved or HDR tone-mapped. No LZW/Deflate/JPEG compression, palette, BigTIFF, associated-alpha or multi-page input. Output is real uncompressed RGBA8 TIFF with metadata removed.

- **AVIF:** native still-image decode only; missing browser decoders fail analysis. 10/12-bit AVIF is rejected, HDR and original profiles are not preserved. Grids, unequal auxiliary dimensions, crop/rotation/mirror properties and sequences are rejected. BMFF structure and all declared `ispe` dimensions are bounded before native decoding; the decoder must agree. No local AVIF WASM package was present, and no dependency was installed. A bundled WASM encoder remains a future option requiring dependency/license, memory and cancellation verification; there is no CDN or hidden fallback.
- **BMP:** uncompressed 24/32-bit BI_RGB, top-down/bottom-up, padded rows; BI_RGB's reserved fourth byte is treated as opaque. Standard 32-bit RGBA BI_BITFIELDS with V4/V5 headers is accepted. Other compression, indexed/16-bit pixels and nonstandard masks are rejected. Output is top-down 32-bit BMP V4 with explicit alpha masks and sRGB color space.
- **ICO:** 1–64 non-overlapping, bounded frames. PNG and uncompressed 24/32-bit BITMAPINFOHEADER DIB frames (including AND masks) are accepted. Every frame is structurally validated; the selected frame is actually decoded. The largest frame is the default and preview; the Source frame selector controls conversion and survives Cancel/Convert Again. Output always contains 16 / 32 / 48 / 256 px PNG frames, generated from the selected source with aspect-preserving transparent letterboxing. Arbitrary palettes/compressed DIB/cursor files are unsupported. Output verifies and re-decodes **all four** frames.
- **SVG:** input only, UTF-8, **1 MiB / 4 MP**, at most 10,000 XML tags, depth 64 and 64 KiB per tag. Supports basic paths/shapes, groups, local gradients and clipping, presentation attributes, transforms, numeric/px width/height and viewBox aspect ratio. Percent/physical-unit dimensions, text/fonts, CSS/style, images/use, scripts/events, foreignObject, animations, external references, entities, DTDs and comments are deliberately rejected, not silently stripped. This is a safe static subset, not full SVG conformance. Worker validation precedes asynchronous Blob-image rasterization; source SVG is never inserted into DOM or shown as a raw preview. Only the resulting Bitmap returns to the worker. Native SVG image decoding uses the browser's asynchronous image pipeline, not a synchronous main-thread renderer.

## Run and use

```sh
npm run dev
```

Select, drop or paste a file, choose the output and Convert. Download saves the real encoded Blob with a matching MIME type and extension. Convert Again and Cancel retain the source and settings. New File/Remove clear state and revoke associated Blob URLs. Change file cancels pending analysis. When the first file is detected as audio, multiple selections enable content-validated audio batch conversion regardless of filenames; other categories use the first file and say so. During conversion, cancel before replacing the input.

Analysis shows filename/size immediately and fills in validated metadata, a bounded thumbnail and available outputs asynchronously. Invalid files remain in Details with a clear explanation, Try again, Change file and Remove. Conversion failures use the same surface with retry.

Progress displays actual processing stages. Native image decode/encode APIs do not expose measurable progress, so they use an **indeterminate** bar, not fabricated percentages. Audio encoding reports processed PCM frames (coalesced to integer percentages); batch progress counts verified files. Read/decode/verification or codec loading may be indeterminate. Percentages are work counts, not elapsed-time estimates. Very short conversions may finish before a progress transition becomes visible; no artificial delay is added. There is no production demo mode or demo URL parameter.

## Browser requirements

All categories require module Workers. Images additionally require worker-side `createImageBitmap`, `OffscreenCanvas` with a 2D context, and `convertToBlob`. Archive compression uses runtime-probed `CompressionStream` / `DecompressionStream`; PCM and WASM audio need neither Web Audio nor Canvas. Native AAC requires working worker-side AudioEncoder/AudioDecoder support, verified by actual encode/mux/decode probes. Baseline WASM needs neither SIMD nor cross-origin isolation/SharedArrayBuffer. Playwright Chromium, Firefox and WebKit have been verified for the explicitly recorded routes; shipping Safari/iOS and other browser versions still need independent testing. Missing worker/decoder support produces an error, never a blocking main-thread conversion fallback. SVG uses a cancellable async image-decoding bridge because worker `createImageBitmap(Blob)` does not reliably decode SVG. Encoder capability is tested in a worker on file analysis and output MIME/signature and re-decodability are checked for every conversion.

## Safety and resource limits

- Whole-buffer image/audio engines: **64 MiB** encoded input/output. Audio batches retain **32 files / 32 MiB total** and **8 million interleaved decoded samples**. These are not streaming codecs.
- Archives: existing ZIP/TAR/GZIP use range-read input and streamed data; new 7z/RAR/XZ/BZip2 WASM input and Zstandard JS input have **64 MiB compressed + 64 MiB expanded** limits. Expanded entries and each disk output are capped at **2 GiB**, additionally limited by available OPFS quota. Without usable disk storage, each accumulated Blob/spool stays within **64 MiB**; large compressible TAR→GZIP can still succeed without OPFS.
- No independent 8192px-side or 16-million-pixel cap: valid image dimensions are evaluated against the combined memory budget and actual browser codec capabilities.
- Image working-buffer estimate: **256 MiB** (`12 × pixels + 2 × input bytes`; TIFF/PNG WASM use a more conservative `20 × pixels + 2 × input bytes`). Native browser decoder/encoder internals are not a hard OS memory sandbox; real peak process memory can exceed this estimate.
- One active worker per converter. Buffered codecs retain a **30-second** deadline. Streaming archives have a **10-minute absolute / 120-second inactivity** deadline; actual I/O renews inactivity, not the absolute limit. Cancel, replacement, reset, errors and deadlines terminate the worker. Late callbacks are ignored.
- Signatures, bounded structural parsing and actual decoding determine the format. Conflicting input extensions/MIME produce compatibility warnings, not rejection. Invalid dimensions, truncated/corrupt structures, unsafe SVG, unsupported animation and decode failures still reject. Output MIME/signature and re-decoding must match the requested format.
- Safe long ZIP paths are preserved with a compatibility warning; unsafe paths/links/collisions remain rejected. Archive metadata remains capped at **1000 entries / 1 MiB filenames / 128 path components**, separately from the streamed data budget. ZIP64, links, devices and unsupported USTAR extensions remain rejected. Unrepresentable USTAR output is hidden while ZIP remains available.
- Bitrate choices are codec-specific, not one universal range. MP3 uses rate-specific legal values, Opus 6–510 kbps, native AAC probes the requested configuration, and Vorbis uses the actual encoder. Failures suggest a lower bitrate, VBR, another rate or WAV; image encoder size failures suggest PNG or a smaller source.

See the **[Phase 4 constraint audit](docs/phase-4-constraints.md)** for every removed, changed and retained constraint, its classification, tests and remaining implementation limits.
- Only a validated, worker-generated thumbnail (max 320 × 180) reaches the UI preview. Raw files are never inserted as HTML/SVG into the document or read/parsed synchronously on the main thread. SVG's validated static subset uses an isolated Blob image during asynchronous rasterization, with abort/deadline URL and image cleanup.
- Original files are immutable and never uploaded. **Streaming archives may write expanded data and output into temporary origin-private browser storage (OPFS)**, not a user-selected filesystem destination. Only explicit Download exports the result. Intermediates are removed on completion; Cancel/error removes all job files; completed disk output is removed on clear/replacement/reset/destruction. Object URLs, bitmaps and canvases are released too. Browser/process crashes can leave temporary files; with Web Locks, later disk jobs reclaim unleased files older than 24 hours, otherwise clear this site’s browser storage manually.

## Architecture and extension

| Responsibility | File |
| --- | --- |
| Format definitions and signature matchers | `src/lib/formats.ts` |
| Format / conversion registries and planner | `src/lib/registry.ts` |
| Codec capabilities, lazy selection, safe fallback and shared context | `src/lib/codec-registry.ts` |
| Native / builtin / WebCodecs / WASM definitions and image implementations | `src/lib/engines/` |
| Pre-decode image structure, EXIF and budget checks | `src/lib/image-format.ts` |
| Shared worker RGBA/Canvas pipeline and verified capabilities | `src/lib/adapters/canvas-codec.ts` |
| Lazy image validation / binary codecs | `src/lib/adapters/{avif,bmp,ico,svg,gif,tiff}.ts` |
| Audio/archive descriptors | `src/lib/{audio,archive}-formats.ts` |
| PCM decode/resample/WAV/AIFF encode | `src/lib/adapters/pcm.ts` |
| Independent compressed audio engine and batch packaging | `src/lib/adapters/audio-codec.ts` |
| Bounded compressed-container/stream validation | `src/lib/audio-validation.ts` |
| Lazy LGPL WASM / native AAC bridges | `src/lib/adapters/{wasm-audio,native-aac}.ts` |
| Self-hosted codec / license and source assets | `static/vendor/`, `static/legal/` |
| Buffered archive helpers and lazy streaming adapter | `src/lib/adapters/archive.ts` |
| Range-read ZIP/TAR, CRC, streams and exact output verification | `src/lib/adapters/archive-stream.ts` |
| Lazy 7z/RAR/XZ/BZip2 reader, bounded Zstd stream, JXL and HEIC codecs | `src/lib/adapters/{archive-extra,jxl,heic}.ts`, `src/lib/engines/jxl.ts` |
| OPFS/bounded Blob sinks, temporary-file cleanup and cross-tab leases | `src/lib/stream-output.ts` |
| Cancellable async SVG bitmap bridge | `src/lib/adapters/{worker-svg,svg-raster}.ts`, `scheduler.ts` |
| Adapter selection and worker protocol | `src/lib/conversion.worker.ts`, `engine-types.ts` |
| Scheduling, abort/timeout/worker cleanup | `src/lib/scheduler.ts`, `engine.ts` |
| State machine and asynchronous lifecycle | `src/lib/machine.ts`, `converter.svelte.ts` |
| Result Blob URLs, filenames and downloads | `src/lib/results.ts` |
| Existing persistent animated frame | `src/lib/MorphSurface.svelte` (unchanged) |

**Phase 7:** streaming ZIP/TAR/GZIP conversion, disk-backed output and Cancel-safe temporary-file ownership; redundant custom-image/audio copies removed. Demonstrated 96 MiB archives above the old 64 MiB ceiling and lower measured Node peak RSS. No new dependencies; MorphSurface unchanged. See **[memory audit, benchmarks, storage/privacy behavior and limits](docs/phase-7.md)**. Run `npm run test:phase7` and `npm run benchmark:phase7`.

**Phase 6 (incremental):** verified AIFF output from all eight audio inputs, PackBits TIFF and 16-bit/grayscale TIFF decoding. No new dependency, binary or initial WASM load. See **[implemented routes, candidate/license/size research, verification and deferred formats](docs/phase-6.md)**. `npm run test:phase6` checks new image/audio conversions and real cancellation.

**Phase 5:** image encoding and audio decode/encode use a shared `CodecEngine<Input, Output, Options>` registry. Native Canvas is preferred; PNG has a real single-thread jSquash WASM fallback. WebCodecs AAC and existing libav WASM use the same selection/context API. Capabilities are exposed in analysis and via `engineCapabilities`; results include the selected engine IDs. Only typed compatibility/availability failures retry, and every candidate must pass output verification. UI, MorphSurface and Worker scheduling are unchanged.

For another engine handling an existing format, add a lazy descriptor in `engines/image.ts` or `engines/audio.ts`; do not modify the UI. See **[Phase 5 architecture, capability contract, licensing/size evaluation and measurements](docs/phase-5-engines.md)**. FFmpeg.wasm and wasm-vips were evaluated but are **not implemented or advertised**.

To add a new format adapter:

1. Implement `EngineAdapter.inspect(file, stage)` and `run(request, stage)` in a new adapter module. Analysis returns detected format/MIME, actual supported output IDs and an optional safe thumbnail. Dimensions are optional in the shared contract; image adapters return them. Keep validation, format-specific limits, capability probes, accurate progress and result verification in the adapter.
2. Add a lightweight `AdapterDefinition` to `adapters` in `registry.ts`: `id`, contributed `formats` (ID, MIME, extension aliases, quality support and signature matcher), `inputs`, `outputs`, and `load: async () => (await import('./adapters/new-codec.ts')).adapter`.
3. The format list and direct routes derive from those registrations automatically. The worker chooses the adapter and imports its implementation only when needed. Vite's ES-module worker output preserves lazy codec chunks. Do not import heavy codec implementations in the page.
4. Add real fixtures and positive/negative/cancellation tests before advertising the new routes. Add UI settings only when that format requires them.

The planner currently returns one direct step. Its steps-list contract allows later multi-hop planning, but no unimplemented intermediary route or codec is advertised or executed. A queue/framework/plugin loader is intentionally not introduced for this local converter.

## Checking latency

Successful image/audio encoder probes are reused within the current page, while every file and every conversion output is still validated. Workers and WASM heaps are not kept alive. Failed probes are retried; runtime errors invalidate remembered capabilities. First audio discovery overlaps independent native/WASM probes. Local repeated-WAV analysis dropped from 224–270 ms to 16–18 ms; first-time downloads and large-file decoding still take time. See [measurements and safety details](docs/checking-performance.md).

## Static hosting

`npm run build` produces a complete static site in **`build/`** using `adapter-static`. Serve that directory, including `vendor/` and `legal/`, with module-JS and `application/wasm` MIME types. No Node conversion server, CDN, SharedArrayBuffer or COOP/COEP headers are required. Use HTTPS or localhost for WebCodecs. `npm run sync:audio-assets` and `npm run sync:png-assets` restore the pinned local codec assets/notices; they overwrite custom library replacements.

## Verification

Node 22.18+ is needed for native TypeScript stripping in unit tests. All test toolchain packages are already present in the repository dependencies.

```sh
npm test
npm run check
npm run build
npm run test:static
```

With the local server running and an existing Playwright + Chromium installation:

```sh
npm run test:browser
npm run test:categories
npm run test:audio
npm run test:checking
npm run test:phase4
npm run test:phase5
npm run test:phase6
npm run test:phase7
npm run benchmark:phase7
```

For an installation outside this repository:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
PLAYWRIGHT_EXECUTABLE_PATH=/absolute/path/to/chromium \
TEST_URL=http://localhost:5173 \
npm run test:browser
```

`npm run test:compatibility` runs the same 134 baseline fixture routes in Chromium / Firefox / WebKit using existing installations. Missing browsers are explicitly **untested**, not passes; `REQUIRE_BROWSERS=1` requires all three. See [Phase 8.1](docs/phase-8.1.md) for executable overrides, status definitions, [Compatibility Matrix](docs/compatibility-matrix.md), and measured results. [Phase 8.2](docs/phase-8.2.md) verifies 68 MiB TAR output storage; [Phase 8.3](docs/phase-8.3.md) adds large ZIP/TAR.GZ input, 10-minute PCM audio and cancellation tests across Chromium, Firefox and WebKit, including safe fallback behavior. Run `npm run test:phase8.2` and `npm run test:phase8.3` against a fresh loopback production preview.

No browser/package is downloaded automatically. For production verification, build first, start `npm run preview -- --port 4174 --strictPort` (or serve `build/` with a plain static HTTP server), and set `TEST_URL` accordingly. Run browser suites sequentially to avoid competing heavy-conversion jobs.

The browser suite exercises the original nine and extended real conversions (including BMP 24-bit input, all ICO output sizes/selected frames, AVIF input and rejected unsafe SVG), downloaded-file bytes and decoding, dimensions/transparency/JPEG background, both quality controls, all eight EXIF orientations, unsupported encoders, validation/errors/retry, high-entropy 16-megapixel cancellation, worker/URL cleanup, input methods, rapid operations, focus, reduced motion, touch emulation, 320px/tablet/resizing and actual frame geometry/timing. Fixtures in `tests/fixtures/` contain opaque, semi-transparent and transparent regions. `swatch.avif` is an 8-bit still with alpha generated locally from the PNG fixture using installed ImageMagick; conversion at runtime never uses that tool. Controller unit tests compile the real runes module with the existing Svelte/TypeScript toolchain.

The category browser suite additionally checks all 16 archive pairs, the legacy PCM routes/settings, batch ZIP contents, actual archive/audio cancellation, errors, 320px/desktop layouts, persistent DOM and zero workers/URLs/uploads/external requests after cleanup. `test:audio` uses the existing local FFmpeg/ffprobe executables to independently decode all 64 real audio downloads, check samples/duration/channels/metadata/SNR, verify MP3 bitrate and actual quality changes, and test mixed batches, Cancel, blocked WASM and missing native AAC. Node tests cover archive attacks, expansion bounds, absent compression APIs, extensible PCM, long names and nested payloads.

Screenshots, downloaded files and measured frame intervals are written to ignored `artifacts/phase1/`, `artifacts/continuous/` and `artifacts/audio/`. Codec notices/source downloads are linked from the footer and `static/legal/NOTICE.txt`; see deployment/replacement obligations in `docs/compressed-audio.md`. Results and unverified environments are recorded in [`docs/QA.md`](docs/QA.md). Physical mobile devices, OS clipboard integration, screen readers and shipping Safari still require manual verification. Firefox/WebKit coverage depends on installed executables; see the Phase 8.1 matrix rather than inferring support from Chromium or simulated capability tests.
