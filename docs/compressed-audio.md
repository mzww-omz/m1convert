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
