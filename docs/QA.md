# Verification history

Latest results: [Continuous development verification](#continuous-development-verification). The Phase 2 record below is historical; its format exclusions/counts describe that earlier commit.

# Phase 2 verification — extended image formats

Verified on 2026-10-22 with Node 26.0.0 and existing headless Chromium **156.0.8078.4**, macOS ARM64. Phase 1 regression coverage is retained. No package/browser download, push or deployment was performed.

## Required commands

| Command | Result |
| --- | --- |
| `npm test` | **34 passed**, 0 failed |
| `npm run check` | 0 errors, 0 warnings |
| `npm run build` | Passed; separate module worker and lazy format/bridge chunks |
| `npm run test:browser` | Passed against development and production preview; final extended assertions verified on `http://127.0.0.1:4174` |
| `git diff --check` | Passed |

The browser suite uses an existing external Playwright installation and local Chromium executable, not downloaded dependencies. Set `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_EXECUTABLE_PATH` and `TEST_URL` as documented in README. Adapter-auto's missing deployment-environment notice is expected and does not prevent build/preview.

## Supported / conditional / unsupported

| Format | Input | Output in verified Chromium |
| --- | --- | --- |
| PNG / JPEG / WebP | Yes, all original 9 routes retained | Yes |
| BMP | 24/32-bit BI_RGB, standard V4/V5 32-bit RGBA bitfields | 32-bit V4 with explicit alpha masks |
| ICO | PNG or uncompressed 24/32-bit DIB frames, 1–64 images | Four PNG frames: 16 / 32 / 48 / 256 px |
| AVIF | Native 8-bit still decode, including alpha | **Unavailable / hidden**; conditional on an actual verified native encoder |
| SVG | Safe static subset only | **Unsupported**, including raster embedding and vector tracing |

No output-only format is registered. GIF, animated PNG/WebP/AVIF, BMP palettes/16-bit/compression/nonstandard masks, compressed/paletted ICO DIB and cursor files remain unsupported.

No local AVIF WASM package was available. Adding a codec dependency was not authorized separately, so none was installed. The native encoder is genuinely probed: PNG fallback is rejected by MIME/signature; valid output must also pass structural inspection, native re-decoding and dimension checks. There is no fake AVIF option, remote codec or CDN fallback. WASM encoding needs a later dependency/license/resource/cancellation evaluation.

AVIF 10/12-bit inputs, grids/unequal auxiliary dimensions, crop/mirror/rotation properties and sequences are rejected. Canvas is an 8-bit RGBA pipeline; HDR, original color profiles and metadata are not preserved. Interoperability evidence uses the included 8-bit still alpha fixture, not a comprehensive AVIF corpus.

SVG supports paths/basic shapes, groups, gradients/clipping, transforms, presentation attributes and numeric/px dimensions/viewBox. Text/fonts, CSS/style, images/use, scripts/events, foreignObject, animation, entities/DTDs/comments and external references are rejected rather than silently stripped. SVG is limited to **1 MiB / 4 MP / 10,000 tags / depth 64 / 64 KiB per tag**. Percent/physical-unit dimensions are unsupported. This is deliberately not full SVG conformance.

## Real conversion verification

- **35 distinct input/output pairs:** PNG, JPEG, WebP, BMP, ICO, AVIF and SVG input × PNG, JPEG, WebP, BMP and ICO output. AVIF output was absent from every actual capability list.
- The original nine paths still check real downloaded bytes, filenames/MIME, native re-decode, dimensions, representative pixels, full/partial transparency and the white JPEG matte.
- Extended paths check magic bytes, dimensions and red pixel content. PNG/WebP results also check full/partial transparency from BMP, AVIF and SVG; BMP→BMP checks exact RGBA equality against the browser's decoded source pixels.
- Real 24-bit BMP input converts to opaque PNG. Unit checks cover padded rows, top-down/bottom-up order, 24/32-bit data, RGBA V4 output, unsupported compression/depth and truncation.
- ICO output has all four directory sizes and every PNG payload is re-decoded. Header/count/offset/overlap/payload bounds and dimension disagreement are checked; DIB 24/32-bit alpha/AND masks are covered by units. Selecting the 16 px frame yields an actual 16 px PNG and selection survives Convert Again; Cancel retention is also unit-tested. The preview intentionally remains the largest source frame and is labeled accordingly.
- A native Worker test wrapper forces WebP/AVIF requests to return PNG; those output options disappear instead of advertising unsupported encoding.
- JPEG/WebP quality changes encoded bytes and survives Convert Again. EXIF transforms 1–8 still normalize exactly once and preserve expected pixels/dimensions.
- Actual downloaded `downloaded.bmp` and `downloaded.ico` were independently read with installed ImageMagick. BMP was identified as 128 × 80 RGBA; ICO decoded as 16, 32, 48 and 256 px RGBA frames. The system `file` command identifies Windows V4 BMP and a four-icon ICO with PNG payloads. These tools are validation-only and never runtime dependencies.

The AVIF fixture was generated locally from the existing PNG with installed ImageMagick (`-depth 8 -quality 70`), retaining alpha. Tests do not invoke ImageMagick or require it to convert images.

## Validation, isolation and lifecycle

- Existing **32 MiB input / 16 MP / 8192 px side / 256 MiB estimated buffers / 64 MiB output** limits remain; SVG adds the stricter limits above. Output inspection uses the output byte ceiling, not the smaller upload ceiling. The memory estimate can reject large, poorly compressed images even below the nominal pixel/output ceilings.
- Pre-decode validation checks detected contents against MIME and extension, all declared dimensions, BMFF/chunk lengths, EXIF offsets, BMP layout and ICO directory bounds. ICO's `image/vnd.microsoft.icon` and BMP's `image/x-ms-bmp` aliases are accepted with matching contents.
- Unsafe SVG inputs (script, foreignObject, external image, external paint URL, stylesheet) are rejected in browser tests; unit tests additionally cover events, use, inline style, entities, DTDs, malformed nesting and excessive depth/pixels. No unsafe SVG is inserted into DOM. Only the worker-validated static subset becomes a temporary Blob image for asynchronous native rasterization, and only its Bitmap returns to the worker.
- Real high-entropy 4000 × 4000 conversion still runs in a native Worker and can be cancelled. No stale result appears; source/settings survive, and the worker is terminated. Stage progress remains indeterminate, never synthetic percentages.
- Worker failure, message errors, deadlines, pre-abort, late replies, controller races and result URL failures retain regression tests. SVG bridge cancellation aborts pending rasterization; a never-settling image decoder test verifies prompt cancellation and immediate Blob URL release.
- End-to-end runs ended with every created worker terminated, no page errors, no external HTTP requests and no uploads. URL counts return to zero after reset/rejected replacement; bitmaps and temporary canvases are explicitly closed/reset. Worker termination reclaims its job resources.

Native browser decoding/rasterization is not an OS memory or CPU sandbox. Real peak native memory and instant native allocation reclamation were not measured. SVG native image decode is asynchronous outside the worker; Cancel revokes its URL, clears the image and terminates the waiting Worker, but cannot promise immediate interruption of a browser-internal raster task already dispatched.

## Surface and motion

`src/lib/MorphSurface.svelte` and `src/routes/layout.css` are **unchanged** from Phase 1. The same physical surface DOM element survives repeated conversions. Upload → Details → Progress → Complete, errors/retry, Cancel and Convert Again remain intact. ICO alone adds a source-frame selector in the existing settings area; no new screen, spinner or artificial delay was added.

Keyboard chooser/focus, paste/drop, replacement/races, reduced motion, emulated touch, long filenames, 320px, tablet/resizing and ICO's 320px settings layout are tested. The ICO mobile screenshot was visually inspected for overflow and action placement.

Final successful production-preview rAF sample:

| Measurement | Upload → Details | 16MP processing / cancellation |
| --- | ---: | ---: |
| Frames | 62 | 72 |
| Median interval | 16.7 ms | 16.7 ms |
| 95th percentile | 16.7 ms | 16.7 ms |
| Intermediate widths | 10 | — |
| Center drift, each axis | 0.0078125 px | — |
| Minimum surface height | — | 147.5 px; no collapse |

These are observed local measurements, not a universal 60fps guarantee. Several repeat runs hit the tool's outer wall-clock deadline without an assertion result; their cause was not established. A later run against a preview left running across a rebuild failed fetching an obsolete hashed entry module. Restarting preview after the final build resolved that confirmed stale-server failure and the full suite passed. Always restart preview after rebuilding. Browser waits are now bounded (45 seconds) and conversion-pair logs identify the last completed path rather than leaving an indefinite silent wait.

## Artifacts and unverified environments

Ignored `artifacts/phase1/` retains the original screenshot/motion paths and adds `ico-mobile-details.png`, `downloaded.bmp`, `downloaded.ico` and `phase2-capabilities.json`. Existing `downloaded.jpg`, mobile/desktop screenshots and motion JSON remain. This directory name is kept to avoid breaking existing tooling.

- **Firefox and Safari/WebKit are unverified.** Playwright launch probes confirmed missing Firefox 1553 and WebKit 2368 executables; no browser was installed. Installed desktop browser apps are not equivalent to a verified Playwright/WebDriver run.
- Physical devices, screen readers and real OS clipboard/Finder drag integration remain manual checks. Touch and clipboard/drop events are browser-emulated.
- AVIF encoding, real HDR/10-bit corpus interoperability, arbitrary SVG documents and arbitrary ICO palette/compression variants are not claimed as tested/supported.
- Optional LSP diagnostics reported unavailable default servers. `npm run check` is the verified Svelte/TypeScript gate; install the desired LSP server or correct `pi-lsp.json` to enable additional diagnostics.

## Continuous development verification

Verified 2026-10-22 on Node **26.0.0**, existing Chromium **156.0.8078.4**, macOS ARM64. Production build served at `http://127.0.0.1:4176`; preview restarted after rebuilding. No package/WASM/browser downloads, push or deployment. `package.json` adds only a test command; dependency manifest versions/lockfile are unchanged.

| Check | Observed result |
| --- | --- |
| `npm test` | **55 passed, 0 failed** (original regression tests retained) |
| `npm run check` | **0 errors / 0 warnings** |
| `npm run build` | Passed, lazy worker codec chunks; only expected adapter-auto deployment-target notice |
| `npm run test:browser` | Passed, original/extended image paths and full motion/lifecycle regression suite |
| `npm run test:categories` | Passed, 20 archive fixture conversions covering 16 unique pairs, 6 audio preset conversions covering 2 pairs, batch ZIP, actual archive/audio Cancel |
| Independent Python standard-library readers | **26 downloaded files** verified with zipfile/tarfile/gzip/wave |
| Independent ImageMagick TIFF decode | Genuine 128×80 8-bit RGBA TIFF, red pixels/full transparency/alpha 128 verified |
| Design detector | No findings in changed page; desktop and 320px audio screenshots inspected |
| `git diff --check` | Passed |

### Actual supported paths

- **54 images:** PNG/JPEG/WebP/BMP/ICO/AVIF/static SVG/still GIF/baseline TIFF → PNG/JPEG/WebP/BMP/ICO/TIFF. Original **35** retained. AVIF output is still absent, so conditional AVIF encoding is not counted. TIFF decoding is the implemented binary decoder, not a nonexistent native Chromium TIFF decoder.
- **2 audio:** WAV → PCM16 WAV; AIFF → PCM16 WAV. Real FFmpeg-generated PCM16 WAV/PCM24 AIFF fixtures check original rate/stereo, 16 kHz mono, and 44.1 kHz stereo output. Further independent PCM8, extensible PCM24 and float32 WAV fixtures exercise layout/subtype validation. Channels, sample counts, duration, sample amplitudes and resampler stop-band attenuation have assertions. Browser downloads are independently readable as 16-bit PCM with the expected rates/channels/durations.
- **16 archive:** ZIP/TAR/TAR.GZ/GZIP → ZIP/TAR/TAR.GZ/GZIP with single-file fixtures. Python-generated stored/deflated ZIP, USTAR TAR, TAR.GZ and ordinary GZIP inputs are used. Output bytes and directory structure are verified by both implemented decoders and Python's independent readers. GZIP routes are hidden for multiple regular files; unrepresentable USTAR names remove TAR destinations. This is **72 unique verified format pairs**, not 72 universally available options; presets and batch packaging are not counted.

### Negative cases and lifecycle

- Archive tests: traversal/absolute/drive/backslash/control/dot/Windows-reserved names, case-insensitive duplicates, file/directory collisions, symlinks, forged central/local size/offset/type fields, CRC/checksum corruption, truncation, entry-count bounds and incrementally capped decompression. Tests prove legitimate highly compressible 2 MiB payloads work within the expanded-byte limit and nested TAR payloads are not mistakenly reinterpreted during GZIP output verification. Native gzip concatenated-member behavior is not claimed portable across browsers.
- Unit simulation removes the native decompressor: gzip destinations disappear, stored ZIP still works, deflate ZIP errors clearly. Native compressor/decoder checks precede advertising gzip routes and choosing ZIP deflate. Numeric compression levels are not implemented because the API has none.
- A real 24 MiB random-file TAR→ZIP job is cancelled after the worker reports **encoding**. A real 1,000,000-sample WAV resample is cancelled after **decoding** begins. Both terminate their active worker, retain settings and return to Details. Existing 16 MP image Cancel, deadlines, pre-abort, stale replies, SVG bridge cleanup and result-URL tests remain green.
- Audio batches process actual WAV and AIFF files sequentially into verified numbered WAV entries in a real ZIP. Invalid batch members fail without partial downloads. Settings cross the actual Worker structured-clone boundary as plain objects/arrays; a controller regression test guards Svelte Proxy cloning failures. Independent field updates guard against stale displayed state during MorphSurface transitions.
- End-to-end suites finish with **zero active workers / zero retained Blob URLs after reset**, no page errors, no external HTTP requests and no uploads. This verifies lifecycle cleanup, not immediate OS/native heap reclamation or peak-memory measurements.
- `MorphSurface.svelte` and `layout.css` remain unchanged. The original physical surface DOM node survives category switches, conversion, Cancel and reset. Category settings reuse the existing controls/grid; no redesign. Desktop/320px screenshots live in `artifacts/continuous/`; animation completion is awaited before screenshots.

### Remaining limitations and next dependency decision

- Firefox **1553** and WebKit **2368** executable paths are absent (filesystem probes repeated); Safari/Firefox were **not tested**. No browser installation or Safari automation permission change was attempted. Physical mobile, assistive technology and real OS clipboard integration remain unverified.
- General MP3/FLAC/OGG/Opus/AAC/M4A/WMA, compressed-audio encoders/bitrate control, 7z/RAR/BZIP2/XZ, animated GIF/APNG, HEIC/HEIF/JXL, compressed/multi-page/HDR TIFF and metadata/ICC preservation remain **unimplemented**, not disguised conversions. WAV/AIFF preserve duration but PCM16 output/resampling is not archival and may lose precision/clip float over-range content.
- Archive support is strict USTAR and bounded stored/deflate ZIP, not arbitrary TAR/ZIP dialects; ZIP64/encryption/PAX/GNU/sparse/special entries are rejected. Metadata retention is limited to paths/bytes/directories and representable times. GZIP output deliberately drops directory entries and original filename.
- The hard expanded-byte/output cap bounds JS buffers; browser codec internals and peak process memory remain unmeasured. The 30-second deadline may reject legitimate large files/batches. Native stage progress is indeterminate.
- General compressed audio and broader archive/image support require approval of exact pinned WASM packages/builds, license obligations, payload size, virtual-filesystem copies, browser/cross-origin constraints, cancellation and pre-allocation extraction limits. See [comparison and implemented limits](continuous-development.md). No major dependency was silently introduced.
- Optional LSP diagnostics returned unavailable default server routes. Svelte/TypeScript verification used the successful `npm run check`; enabling additional LSP checks requires installing/configuring a desired server in `pi-lsp.json`.
