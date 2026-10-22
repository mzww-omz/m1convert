# Phase 1 verification

Verified on 2026-10-22 with Node 26.0.0 and existing headless Chromium (macOS ARM64). This report supersedes the Phase 0 report in earlier commits. No package/browser download, push or deployment was performed.

## Required commands

| Command | Result |
| --- | --- |
| `npm test` | 25 passed, 0 failed |
| `npm run check` | 0 errors, 0 warnings |
| `npm run build` | Passed; emits a separate ES-module worker and lazy codec chunk |
| `npm run test:browser` | Passed against development server and production preview (`TEST_URL=http://localhost:4174`) with existing Playwright/browser executable paths |
| `git diff --check` | Passed |

Adapter-auto reports that no production deployment environment is configured. This does not prevent local build/preview; deployment is out of scope.

## Real conversion verification

- All **nine** PNG/JPEG/WebP input/output pairs, including same-format re-encoding.
- Every downloaded output is checked by magic bytes, matching extension, native browser re-decoding, dimensions and representative pixels.
- Full and partial transparency survive PNG/WebP; transparent JPEG pixels become white.
- JPEG/WebP quality controls change actual encoded bytes and survive Convert Again.
- EXIF orientations **1–8**, including mirrored orientations, produce correctly oriented pixels and display dimensions without applying rotation twice.
- `artifacts/phase1/downloaded.jpg` is an actual saved conversion. The system `file` command identifies JPEG/JFIF, 8-bit precision, 128 × 80; the browser re-decodes it successfully.
- A native worker encoder is deliberately made to return PNG when asked for WebP in a test-only wrapper. The real capability probe hides WebP instead of advertising false support.

## Safety and lifecycle

Unit tests cover signatures, nine registry routes, unsupported routes, MIME/extension mismatch, truncated structures, malformed EXIF/RIFF offsets, APNG/animated WebP rejection, encoded-size/pixel/dimension/estimated-memory/output limits, safe output names, worker errors/message errors/deadlines, pre-abort and late replies, real Blob URL invalidation, controller retries and asynchronous races.

Browser tests cover corrupt/unsupported/empty files, 32 MiB input rejection, pre-decode oversized dimensions, extensionless detection, replacement during analysis, rapid starts, genuine heavy-work cancellation, error/retry, Convert Again/New File and resource cleanup. Test-generated input is a **real high-entropy 4000 × 4000 JPEG**, not a fake size property. Conversion starts in a native worker; Cancel terminates it, no later result appears, and input/settings remain usable. Injected encoder failures and encoder fallback exist only in tests, never in application code.

The browser run ended with every created worker terminated, no live conversion job, no page errors, no external HTTP requests and no upload requests. URL counts are checked through complete/re-convert/reset, and URL allocation failure is tested to ensure a recoverable error rather than stuck progress.

## UI and motion

`src/lib/MorphSurface.svelte` is unchanged from the pre-Phase-1 revision. Its same outer DOM element is verified through repeated conversions. Filename, size, thumbnail and capabilities populate asynchronously; actual native processing stages use indeterminate progress without percentages or artificial delays.

Keyboard picker/focus, native file chooser, browser-dispatched file paste/drop, Change/Remove, rapid replacement, 320px, 375px, 768px, 1024px, 1280px, resizing, reduced motion and emulated touch were exercised.

A pre-existing Tailwind `.hidden` collision made hidden morph content `display:none`, causing zero-height measurement and transient frame collapse. A failing frame-geometry check reproduced it. A narrowly scoped CSS override keeps content measurable without changing the component, its durations, anchoring or DOM. Regression sampling now confirms no collapse.

Final production-preview rAF measurements:

| Measurement | Upload → Details | 16MP conversion / cancellation |
| --- | ---: | ---: |
| Frames sampled | 62 | 70 |
| Median interval | 16.7ms | 16.7ms |
| 95th-percentile interval | 16.7ms | 16.7ms |
| Distinct intermediate widths | 10 | — |
| Horizontal / vertical center drift | <0.008px | — |
| Minimum surface height | — | 147.5px (never collapsed) |

These are observed local timings, not a universal 60fps guarantee or a measurement of peak native decoder memory.

## Artifacts

Generated and untracked in `artifacts/phase1/`:

- `upload.png`, `details.png`, `progress.png`, `complete.png`, `error.png`
- `mobile-upload.png`, `mobile-details.png`, `mobile-progress.png`, `mobile-complete.png`
- `downloaded.jpg`, `motion-metrics.json`, `heavy-motion-metrics.json`

Screenshots were inspected for layout/overflow. Progress screenshots are taken after content entrance rather than during its initial fade.

## Remaining limitations / not verified

- Safari, Firefox, physical mobile devices, screen-reader software and actual OS clipboard/Finder drag integration were not exercised. Paste/drop tests dispatch real browser File events; touch is emulated.
- Native browser decoder internals are not an OS sandbox. Deterministic input/pixel/dimension/output limits and an estimated buffer budget are enforced; real process peak memory and immediate native allocation reclamation were not measured.
- Canvas produces 8-bit RGBA output using browser color conversion; original HDR/16-bit precision, color profiles and metadata are not preserved. JPEG uses a fixed white matte. Animated formats and additional codecs remain future work.
- Planner execution is direct-only. Multi-hop execution, additional format-specific controls and alternate decoders require future adapters/tests before being advertised.
