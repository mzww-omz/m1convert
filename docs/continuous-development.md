# Continuous converter development

## Constraints and implementation plan

Preserve MorphSurface and its persistent DOM, all existing image routes, local-only files, one cancellable worker per job, 32 MiB uploads, 64 MiB outputs and 30-second deadlines. No push/deploy, runtime downloads, or dependency installation. Implement inline with test-first checks and small commits; unsupported formats never appear as output choices.

1. **Archive engine** (`archive-formats.ts`, `adapters/archive.ts`, `tests/archive.test.mjs`): bounded ZIP stored/deflate, strict USTAR TAR and GZIP/TAR.GZ; ZIP/TAR/TAR.GZ outputs, single-file GZIP where applicable. Validate names, duplicate/colliding paths, checksums, lengths, expansion budgets and prohibited entry types before exposing routes. Standard CompressionStream only, lazy worker import. Verify real files, corrupt input and bomb limits.
2. **Audio engine** (`audio-formats.ts`, `adapters/pcm.ts`, audio tests): PCM WAV/AIFF to 16-bit WAV; sample-rate/channel options, metadata removal and bounded resampling. Thread typed settings through state/controller/UI without changing MorphSurface. Verify real PCM fixtures, sample values/duration, malformed chunks and resource limits.
3. **Images**: add bounded static GIF input and baseline uncompressed TIFF input/output where feasible; preserve animation rejection rather than silently flattening. Verify pixels/alpha and existing routes.
4. **Integration**: reuse existing fields for category-specific settings; generic stage/error copy, no redesign. Browser real downloads, cancellation, worker/URL cleanup, regression suite, Svelte check and production build. Record actual routes, limits and unavailable browsers. Commit each independently verified deliverable.

## Dependency / license decisions

| Option | Benefits | Costs / decision |
| --- | --- | --- |
| Browser CompressionStream | No package/WASM/license payload; incremental bounded decompression | Runtime probe for gzip/deflate-raw; no level parameter. ZIP offers stored vs deflate, not fictitious numeric levels. |
| Local PCM parser/encoder | Small, worker-safe, deterministic PCM routes | No MP3/AAC/FLAC demux/encoder. WAV output is PCM16, metadata stripped. |
| FFmpeg.wasm | Broad audio/container support | Major dependency (wrapper + large core WASM), build-specific LGPL/GPL obligations, virtual FS copies, thread/cross-origin isolation and Safari memory constraints. Not installed/advertised without approval of exact pinned build/license/size. |
| libarchive WASM / 7z WASM | 7z, RAR, BZIP2, XZ coverage | Major dependency; exact license/transitive code and pre-allocation extraction limits need review. Not installed. |
| Native image codecs | Existing bounded Canvas pipeline | AVIF output remains runtime-verified only; HEIC/JXL/TIFF compression/animation require additional codecs. |

## Verification focus

- Archive traversal, Windows paths, links/devices, duplicate/case-folded/file-directory collisions; never extract to filesystem or DOM.
- Incorrect size declarations/CRC/checksum, truncation, concatenated streams, compressed bombs and counts; enforce streaming expansion cap, not only post-allocation checks.
- Invalid audio chunk offsets/alignment/rates/nonfinite samples; preserve duration, reject unsupported encodings rather than reinterpret bytes.
- Abort/reset/replacement must terminate worker and ignore stale results; no main-thread decoding fallback.
- Native API support is runtime-specific; never advertise a route that requires an unavailable compressor/decompressor.

## Deferred scope

Full animation/APNG, HEIC/HEIF/JXL, compressed/archival TIFF, metadata/ICC preservation, compressed audio encoders, 7z/RAR/BZIP2/XZ and audio batch UI need further implementation/dependency decisions. This document records limitations, not a claim of completed support. Actual verification is recorded after implementation.
