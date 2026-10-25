# Phase 10 — Video containers and codecs

Implemented in `feat/phase10-video`. Phase 10 is intentionally limited to **video**; eBook, Office, PDF, additional image and archive format proposals remain separate work.

## Scope

- Input/output container types: MP4 (`.mp4`, `.m4v`), QuickTime MOV (`.mov`, `.qt`), WebM (`.webm`), Matroska (`.mkv`).
- Video codec candidates: AVC/H.264; HEVC/H.265, VP8, VP9, AV1 where the browser implements the corresponding encoder and decoder. Container/codec combinations are constrained by the UI's compatibility table.
- Audio codecs are copied when compatible or converted to Opus/AAC where native browser capabilities allow. Currently Chromium may refuse AAC encoding: WebM (VP9/Opus) → MP4 therefore succeeds with H.264/Opus, not H.264/AAC. MP4/MOV containing Opus may fail on old devices.
- One video track and zero or one audio track are required. Extra audio, subtitles, data and other tracks **fail the inspection**. No silent track removal. Track count, duration, dimensions and output video codec are checked by re-parsing the generated container.
- Conversion modes: **Auto** (Mediabunny packet-copy when possible, otherwise transcode), **Remux** (forced packet-copy; fails if incompatible) and **Transcode** (force video re-encoding, codec and quality configurable).
- Video metadata is inspected but no untrusted source video is rendered in the UI. Existing MorphSurface, worker isolation, cancellation and download lifecycle are preserved.
- Sniffing is based on file bytes, not the extension alone. MP4/M4A share `ftyp`; the worker probes for actual video tracks to distinguish them.

## Implementation

- `src/lib/video-formats.ts`: container signatures, output names and permitted video codecs.
- `src/lib/adapters/video.ts`: Mediabunny tracks, browser-probed output choices, native WebCodecs transcoding/remuxing and verification.
- `src/lib/video-output.ts`: Mediabunny random-access `StreamTarget` into browser-origin private file system (OPFS), `BufferTarget` fallback for small inputs.
- `src/lib/conversion.worker.ts`: content-based MP4/M4A routing, existing worker cancellation.
- `src/routes/+page.svelte`: compact processing/codec/quality controls in existing details panel.

Mediabunny 1.62.0 was already a pinned project dependency. No remote conversion, fetch-based transcoding, telemetry or new codec CDN is added. WebCodecs availability varies by browser, OS and hardware. The advertised *container* choices are checked against the browser and input; choosing an optional codec may still fail when that codec is not available at conversion time.

## Resource and compatibility limits

| Item | Current behavior |
| --- | --- |
| Video input maximum | Nonempty, up to 2 GiB. Larger or invalid files rejected. |
| Output in OPFS | Up to 2 GiB and available temporary storage budget, whichever is lower. File is leased and removed by existing result cleanup. |
| No usable OPFS | In-memory output only for inputs under 64 MiB; output is also limited to 64 MiB. |
| Large or complicated files | Playback time and working decoder memory depend on the browser. There is no hard guarantee of long-duration success. |
| Track structure | Exactly one video; zero/one audio; reject subtitles, multiaudio and auxiliary tracks. |
| Remux | Video/audio bytes are packet-copied when destination supports them. Output headers, timebases and other metadata may be rewritten. |
| Transcode | Lossy; video decoded and re-encoded through browser WebCodecs. Quality is a requested encoder hint, not a fixed bitrate. |
| Color/HDR | No promise to preserve HDR, bit depth, ICC/primaries, frame timing, alpha or advanced metadata through a transcode. |
| File formats | No MPEG-TS, AVI, FLV, animated image→video, soundtrack extraction or arbitrary subtitles yet. |
| Platform test | Chromium headless with FFprobe; Firefox, Safari, Android and long-duration files not yet regression-tested. |

## Reproduction

1. Generate or keep the tiny fixture set under `tests/fixtures/video`. Included files: two-second 160×90 H.264/AAC MP4, QuickTime MOV and Matroska MKV, and VP9/Opus WebM.
2. Run `npm run dev -- --host 127.0.0.1` in one terminal.
3. Run `npm run test:phase10` in another terminal. Requires Chromium/Playwright and system FFprobe.
4. Also run `npm run check`, `npm run build`, `npm test`. Earlier regression suites should remain passing.

The browser test does:

| Input | Output / Mode | FFprobe expectation |
| --- | --- | --- |
| MP4 H.264/AAC | MKV / Remux | H.264 + AAC (copied) |
| MP4 H.264/AAC | WebM / Auto | VP9 + Opus |
| MP4 H.264/AAC | MP4 / Transcode AVC | H.264 + AAC (audio copied) |
| WebM VP9/Opus | MP4 / Auto | H.264 + Opus |
| MOV, MKV | Inspected | Correct recognized video outputs |

It also checks that an incompatible forced remux fails explicitly, multi-audio input is rejected instead of silently truncated, actual MP4 content wins over a misleading `.mp3` filename/MIME, output tracks and duration, no external network requests or upload methods, worker/object-URL/OPFS cleanup, and the retained MorphSurface DOM identity.

## Deferred work

Phase 11+ candidates: runtime-filtered specific encoder options, additional audio codec targets, video-only stream splitting, extra containers (AVI/TS), support for audio/subtitle selection without silent removal, true long-video stress tests, Firefox/Safari real-device checks, and a separate eBook and office/document/PDF-preserving conversion design.
