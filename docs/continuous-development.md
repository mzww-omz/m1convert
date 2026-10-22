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

Full animation/APNG, HEIC/HEIF/JXL, compressed/archival TIFF, metadata/ICC preservation, compressed audio encoders and 7z/RAR/BZIP2/XZ need further implementation/dependency decisions. Audio batch UI is implemented. Exact numeric compression levels are unavailable in native CompressionStream; ZIP offers Store/Deflate instead.

## Implemented matrix and operating limits

### Audio

- WAV: unsigned PCM8, signed PCM16/24/32, float32; standard `fmt` and PCM/float extensible GUIDs, full-width valid bits, mono/stereo layouts only. Rejects RF64, other compressed subtypes, mismatched byte-rate/block alignment, duplicate/missing chunks, partial frames, invalid rates/nonfinite samples and truncation. AIFF supports signed PCM8/16/24/32 with valid 80-bit integer sample rate, frame count and SSND offset; AIFC is rejected.
- Both inputs produce genuine PCM16 WAV; metadata is removed, float samples clip to [-1,1], and output quantizes without dither. PCM bitrate = sample rate × channels × 16. Arbitrary compressed-audio bitrate settings are not implemented.
- Source rate 8000–192000 Hz, mono/stereo, at most **8,000,000 interleaved decoded samples**. Output has the same sample budget, checked before allocating resampling buffers. Choices: original or 8000/16000/22050/24000/32000/44100/48000/88200/96000/192000 Hz; original/mono/stereo channels. Stereo downmix averages channels, upmix duplicates mono. Resampling is a fixed 64-tap Blackman-windowed sinc with low-pass filtering, not archival mastering quality (especially for extreme ratios).
- Batches: at most **32 files / 32 MiB total**; every file is content-validated sequentially. Results are numbered PCM16 WAVs in a stored ZIP, bounded by the archive output budget. Invalid input fails the whole batch without partial downloads. The existing 30-second job deadline applies to the entire batch; stages are indeterminate, not fabricated percentages. Cancel preserves inputs/settings; reset/destroy releases them.

### Archives

- ZIP inputs accept stored/raw-deflate, ASCII or explicitly UTF-8 names, bounded central/local headers and validated optional data descriptors. Checks CRC32, actual/declaration lengths, record overlap/alias/gaps, encryption/type flags, disk numbers and ZIP64 sentinels. Rejects ZIP64, encryption, split/self-extracting archives, links/devices and other compression methods. CP437 names and Unicode-path override extras are not interpreted.
- TAR is strict POSIX USTAR with checksum, octal numeric fields, exact bounded payload and zero padding/end records; only regular files/directories. GNU/PAX extensions, links, sparse/device/special entries are rejected. TIFF and TAR parsers intentionally support safe subsets, not general format conformance.
- GZIP uses the browser decoder, including its integrity/trailing/member rules; concatenated-member compatibility is not independently guaranteed across engines. Header filenames/timestamps are ignored. GZIP content with a USTAR signature is analyzed as TAR.GZ; explicitly named `.tar.gz`/`.tgz` must contain valid TAR. Empty all-zero TAR inside gzip is interpreted as TAR only with an explicit TAR filename, avoiding misclassification of zero-filled ordinary files.
- Output ZIP offers Store/Deflate. If either raw-deflate native encoder/decoder is missing, ZIP uses real stored records. GZIP/TAR.GZ require both native gzip encode/decode. TAR destinations are hidden when names do not fit USTAR or uncompressed TAR output exceeds the output budget. GZIP is offered only for one regular file, dropping directory entries. Native CompressionStream does not expose numeric levels.
- Paths reject traversal, absolute/drive/backslash names, control characters, empty/dot components, ambiguous trailing dots/spaces and reserved Windows devices. Rejects duplicate/case-folded/NFC-normalized paths and file/directory collisions before ZIP inflation. No archive filenames become HTML or filesystem paths.
- **1000 entries / 64 MiB total expanded bytes / 64 MiB encoded output / 32 MiB upload**. ZIP declarations are checked before inflation, actual decompression is incrementally capped at each declared entry size; gzip has the same total expansion cap. No ratio heuristic: legitimate repetitive files are accepted only within the hard expanded-byte cap. Tiny malicious compressed streams cannot cause unbounded JS output allocation. Native codec internals and total process peak memory are not an OS sandbox or a proven hard 256 MiB cap.
- ZIP/TAR/TAR.GZ retain file bytes, paths, directories and representable mtimes. ZIP uses two-second DOS timestamps interpreted as UTC; original time zone is unavailable. UID/GID, original permissions, extended attributes and GZIP header metadata are not retained. Output permissions are 0644/0755. CRC/checksums are integrity checks, not authentication.

### Images

- 9 inputs × 6 verified outputs = **54 image routes**, including original 35. Added still GIF input and TIFF input/output. AVIF output remains conditional and was unavailable in tested Chromium; it is not counted.
- GIF animation is rejected rather than flattened. TIFF is uncompressed RGB8/RGBA8, single-page, orientation 1, unassociated alpha; ICC/transfer functions are rejected to avoid pretending color management. Other image limits, orientation normalization, transparency behavior and native Canvas limitations remain unchanged.

## Verification and counts

See [QA evidence](QA.md#continuous-development-verification). Verified **72 format pairs** in Chromium: image 54 + audio 2 + archive 16 (single-file fixtures enable GZIP routes). Same-format re-encoding is included; presets, stored/deflated ZIP variants and batch ZIP packaging do not inflate the pair count. Archive route availability is file- and browser-dependent. No package, WASM binary, browser or codec was downloaded; no push/deploy occurred.
