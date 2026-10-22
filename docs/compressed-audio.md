# Compressed audio implementation and dependency review

## Decision / plan

Implement inline, test-first, preserving the existing PCM engine, 72 routes, MorphSurface, local-only conversion, worker termination, 32 MiB input / 64 MiB output and decoded sample budgets. No push/deploy. WASM dependencies are authorized for this request; project-wide GPL adoption is not.

| Candidate (registry reviewed 2026-10-22) | License / size evidence | Decision |
| --- | --- | --- |
| @ffmpeg/ffmpeg 0.12.15 + @ffmpeg/core 0.12.10 | MIT wrapper; **GPL-2.0-or-later core**, 64,689,644 bytes unpacked (includes multiple module distributions) | Do not adopt without explicit GPL approval. Broad codec coverage but unnecessary video/CLI payload and virtual-FS copies. |
| @libav.js/variant-obsolete 6.10.9 | LGPL-2.1; 15,634,375 bytes unpacked across wasm/asm/threaded builds | Select only single-thread baseline WASM and ES module glue. MP3/LAME, FLAC, Vorbis, Opus, PCM; no AAC codec in this build. Runs inside the existing worker without subworkers/COOP/COEP/SIMD. Retain license notices, corresponding sources and replacement instructions; LGPL is library-scoped, not a GPL conversion of application code. |
| Mediabunny 1.62.0 | MPL-2.0; 11,049,020 bytes unpacked including distributions/sources | Select for AAC/MP4 demux/mux and native WebCodecs bridge only. AAC capabilities must be probed; no native support means explicit unavailability, not a pseudo-codec. Unmodified library sources remain MPL. |
| @mediabunny/mp3-encoder 1.62.0 | MPL wrapper + LGPL LAME; 1,685,429 bytes unpacked | Not needed alongside selected audio WASM; creates its own subworker. |
| @mediabunny/aac-encoder 1.62.0 | MPL wrapper + embedded FFmpeg AAC WASM; 4,701,885 bytes unpacked, SIMD/subworker build | Defer rather than duplicate FFmpeg and add source/build-compliance complexity. Native AAC first. |
| Native WebCodecs only | Platform codecs, no downloaded payload | Insufficient for dependable MP3/Vorbis/FLAC encoding; use only runtime-verified AAC paths. |

Package unpacked sizes are not browser download sizes or measured performance. Record exact shipped/glue/gzip sizes and measured timings after implementation. No CDN/runtime file upload or remote conversion.

## Tasks

1. Add pinned dependencies and reproducible self-hosted libav assets with notices/source access. Test asset identities and lazy initialization. Keep baseline PCM→WAV routes WASM-free.
2. Add independent compressed audio adapter, bounded container/content validation and actual stream codec checks. Incrementally demux/decode to the existing PCM representation, enforcing channels/rates/sample budget before accumulation. Reuse PCM resampling/channel conversion; verify every encoded output by actual demux/decode and duration/sample/channel checks. Tests use independent FFmpeg-generated fixtures and downloaded output readers.
3. Add MP3/WAV/FLAC/Vorbis/Opus encode support; AAC/ADTS and M4A/AAC conditional on actual native WebCodecs support. No video/multiple-stream/unsupported embedded codec is treated as supported audio. Batch uses existing stored ZIP workflow and shared settings, capped count/total bytes/output; terminate enclosing worker on Cancel/deadline.
4. Thread bitrate/quality settings and measured stage/progress through controller/state/worker with plain structured-clone data. Preserve UI grid and surface; show settings only when meaningful. Metadata is removed, never silently claimed preserved.
5. Full existing regression suite + new real-file routes, bad MIME/extension/containers/codecs/truncation, bounded expansion, cancellation during load/decode/encode, release checks and browser matrix. Record native AAC limitations, numerical/quality tolerances, latency/payload and commits.

## Implemented result

### Actual matrix (Chromium 156.0.8078.4, macOS ARM64)

| Input | WAV | MP3 | FLAC | OGG Vorbis | Ogg Opus | AAC/ADTS | M4A/AAC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WAV PCM | Yes | Yes | Yes | Yes | Yes | Native* | Native* |
| AIFF PCM | Yes | Yes | Yes | Yes | Yes | Native* | Native* |
| MP3 Layer III | Yes | Yes | Yes | Yes | Yes | Native* | Native* |
| FLAC | Yes | Yes | Yes | Yes | Yes | Native* | Native* |
| OGG Vorbis | Yes | Yes | Yes | Yes | Yes | Native* | Native* |
| Ogg Opus | Yes | Yes | Yes | Yes | Yes | Native* | Native* |
| AAC-LC / ADTS* | Yes | Yes | Yes | Yes | Yes | Native* | Native* |
| M4A/AAC* | Yes | Yes | Yes | Yes | Yes | Native* | Native* |

**56 actual audio format pairs**, including 49 between the requested seven formats and 7 AIFF legacy-input pairs. With 54 image + 16 archive pairs, Chromium verified **126 unique format pairs**; the prior 72 remain. Presets, compression methods and batch ZIP packaging do not inflate this count.

`*` AAC decode and encode are native, separately tested against actual file codec/configuration and generated output. They are not provided by the selected WASM build. Missing native encoder/decoder means destinations are absent; unsupported AAC input errors explicitly. Browser support for a container extension alone is never accepted as codec support. The tested profiles are AAC-LC; no promise of arbitrary HE-AAC/DRM or other MP4 codecs. ALAC/video/multi-track M4A, fragmented MP4, compact sample tables and QuickTime v1 audio sample entries are rejected.

### Settings, bounds and lifecycle

- MP3 and Vorbis: target bitrate or VBR quality 1–100. MP3 quality maps to LAME q≈9…0; Vorbis maps to q≈0.1…10. High/low settings are independently verified to produce different bytes and higher/lower measured SNR. MP3 bitrate must be an actual supported MPEG-rate/bitrate combination (129 kbps is rejected rather than rounded). Native AAC and Opus bitrates are targets; VBR/content and the platform can change achieved average bitrate. FLAC/WAV are 16-bit, with no lossy quality slider.
- Source sample rate 8000–192000 Hz, mono/stereo. Output sample-rate/channel conversion reuses the existing bounded PCM resampler/downmix. UI removes incompatible explicit MP3/Opus rates and visibly adjusts incompatible low-rate MP3 bitrate settings on format/rate changes. MP3's compatible-original mode falls back to 48000 Hz when the original rate is unsupported. Opus always decodes/outputs at 48000 Hz, explicitly labeled.
- **32 MiB encoded input, 8,000,000 interleaved decoded/output samples, 64 MiB output, 32 files / 32 MiB aggregate batch**, and the existing **30-second entire-job deadline** are retained. At 48000 Hz stereo the decoded budget is approximately **83.3 seconds**. This implementation is a bounded clip converter, not an unbounded music-library or long-form streaming converter. Larger files require a future streaming PCM pipeline, not merely increasing a memory limit.
- MP3 checks complete frame boundaries, stable rate/channels, Layer III headers and bounded ID3v2.3/2.4 tags (plus trailing ID3v1); free-format, ID3v2.2/APE trailers and other MPEG layers are unsupported. Ogg validates page CRC/sequence/serial/BOS/EOS and accepts one Vorbis/Opus logical stream, not chained/multiplexed input. FLAC validates STREAMINFO budgets and actual sample count; strict decoder `err_detect=crccheck+explode` rejects frame CRC errors. Raw ADTS is bounded AAC-LC, one raw block per frame. Native lossy decoder error-concealment/bit-error behavior is platform-specific; ADTS CRC integrity is not independently proven.
- Before native MP4 parsing, recursive box depth/count, single audio sample entry, rate/channels, sample-table counts/lengths/aggregate sample sizes and chunk offsets are checked. Tables have at most 100,000 entries; file/child ranges cannot overflow. No raw metadata/filenames become HTML, and demuxers read a local Blob/memory file, never a remote URL. MIME/extension mismatches remain errors.
- Every produced file is structurally checked and really demuxed/decoded again. Output codec/rate/channels and duration are compared; PCM/FLAC have a one-sample duration tolerance, lossy codecs 80 ms. FLAC/WAV output quantizes to PCM16 without dither; they are not archival precision-preserving routes from >16-bit/float sources. AAC/MP3/Opus delay/padding and repeated lossy conversions can alter sample count and quality. Do not use these routes for sample-exact joins or gapless archival work.
- Progress is processed PCM-frame counts during encoding, coalesced to integer percent updates, then output verification. Batch percentages count completed, verified files equally, not byte/time-weighted estimates. Read/decode/codec loading can be indeterminate. No timers invent progress.
- Success/error/cancel/deadline terminate the enclosing existing Worker. Libav demux/decoder/encoder/muxer contexts and virtual files are released in finally blocks; native input/output and AudioSamples are disposed/closed. There are no libav subworkers or threaded/SIMD builds. Cancellation during real encoding and blocked WASM initialization has browser assertions for zero workers/URLs and stale-result suppression. Immediate native heap reclamation/peak process memory was not measured.
- Source tags (title, artist, artwork, original container metadata) are removed, not retained. Encoder/software IDs and codec timing data may be newly generated. Batch results contain numbered genuinely encoded files in a verified stored ZIP; one bad member fails the job without partial downloads.

### Payload and performance evidence

| Self-hosted asset | Raw bytes | gzip bytes (local gzip measurement) |
| --- | ---: | ---: |
| baseline `obsolete.wasm.wasm` | **2,368,147** | **952,101** |
| wrapper `.mjs` | 28,363 | 6,891 |
| WASM glue `.wasm.mjs` | 289,603 | 59,527 |
| Total selected libav runtime | **2,686,113** | **1,018,519** |

WASM alone is **2.26 MiB**; runtime including glue is **2.56 MiB**, approximately **0.97 MiB gzip**. Transfer compression depends on the hosting server; these are measured gzip sizes, not asserted network transfer sizes. The lazy Mediabunny worker chunk in this build is 483,349 bytes / 122,511 gzip. Other small application/worker chunks are additional. None of the WASM assets are requested on initial upload-screen load, and image/archive conversions do not initialize audio WASM. Audio analysis probes compressed-output codecs; thus selecting a WAV can load WASM to discover its available destinations. Direct legacy PCM→WAV processing itself does not depend on WASM, and works when the WASM request is blocked.

Corresponding source archives total **31,442,400 bytes** (~30 MiB), plus notices. These are same-origin optional downloads, never loaded during conversion. The complete upstream release ZIP was verified against published SHA256 `ec718371836fdfe00b455c8a34c826cfbcf9b72e35cc75b0bc5c739900ad3f01` before extracting sources.

For the two-second 48000 Hz stereo fixture, final browser click→Download-visible time was **208–1539 ms**, median **664 ms** over the 56 paths. These include worker startup, capability/module loading and UI morph timing, not isolated codec CPU benchmarks; they are not a cross-device performance guarantee. Independent decoded lossy outputs had SNR **≥22.1 dB** against the original test signal, including already-lossy inputs/re-encodes; unchanged PCM16→WAV/FLAC samples matched exactly. This single synthetic signal and duration are not a comprehensive perceptual quality study.

### Licensing and deployment / replacement

- Selected libav build configuration includes only LGPL-compatible FFmpeg/LAME and BSD Opus/Vorbis/Ogg; its config does not enable GPL or nonfree components. The GPL `@ffmpeg/core` package was not installed. Pinned versions/lockfile, byte hashes, asset-copy script and LGPL notices are committed. No project-wide GPL license change was made.
- `static/legal/NOTICE.txt` (linked from the footer) provides notices, same-origin corresponding source archives, upstream provenance and replacement/relink instructions. Preserve **both** `static/vendor/` and `static/legal/` in any later deployment. Do not delete source delivery to reduce the apparent runtime payload. The unmodified libav module/glue/WASM remain independently replaceable at the documented URLs; there is no integrity check in the application that prevents modified library replacement. Manifest checks are development tests, not browser enforcement.
- `npm run sync:audio-assets` copies the exact pinned npm build and regenerates runtime hashes; it intentionally overwrites local library modifications, so do not run it after installing a custom replacement build. Rebuild libav from the shipped source tree/dependencies per its Makefile and replace the compatible assets if modifying the LGPL library. Mediabunny's MPL notice and exact source package URL are also provided; application-owned files have not been relicensed. This is technical compliance/provenance documentation, not legal advice about a jurisdiction's patent or distribution obligations.
- No production deployment or push was performed. Existing local FFmpeg/ffprobe are validation-only, not conversion-runtime dependencies.

### Verification / remaining uncertainty

All **67 Node tests**, Svelte/TypeScript check (0 errors/warnings), production build, original image browser regression, archive/PCM browser suite, and the new audio matrix/lifecycle suites passed. Output files were independently read by installed **FFmpeg/ffprobe 8.1.1**; browser **Chromium 156.0.8078.4**. Tests verify 56 real audio routes, numeric sample/rate/channel/duration/SNR assertions, metadata removal, bitrate/quality changes, mixed MP3/FLAC/M4A batches, 320px/desktop layout, persistent DOM, measured progress, actual Cancel and no uploads/external requests.

Fixtures: WAV/AIFF/MP3/FLAC/Opus/AAC/M4A/ALAC generated locally with FFmpeg from a two-channel multi-frequency source; ordinary Vorbis was generated with the selected libvorbis WASM encoder and then independently decoded with FFmpeg. FFmpeg 8.1.1's experimental native Vorbis encoder produced a corpus with a right-channel disagreement between native FFmpeg and libvorbis decoders; it was not used as the quality reference. This decoder/experimental-encoder interoperability case is **unresolved**, not claimed fixed. General music/speech, rare profiles, long files and multiple decoder implementations still need broader corpus tests.

Firefox 1553 and WebKit 2368 executable paths are absent; neither browser was installed or claimed tested. Chromium tests simulate missing native AAC to ensure WASM routes remain and unsupported AAC destinations disappear; this is not an actual Firefox/Safari run. LSP diagnostics reported unavailable default routes; successful `npm run check` is the actual Svelte/TypeScript verification. See the latest [QA record](QA.md#compressed-audio-verification).
