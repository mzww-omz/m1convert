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
