# Phase 8.1 — Browser compatibility foundation

## Scope

Existing baseline: **134 single-step format pairs = 54 image (9 × 6) + 64 audio (8 × 8) + 16 archive (4 × 4)**. Registry descriptors include conditional AVIF output; that is not silently counted as an additional baseline route. No formats, dependencies, WASM engines, UI redesign, uploads or deployment were added. `MorphSurface.svelte` is unchanged; the shared test asserts its DOM identity survives conversion.

Existing Node tests cover parsers, codecs, registry, worker lifecycle and simulated missing features. Existing browser suites were Chromium-only, including deeper image/pixel, audio/SNR, cancel/retry and Phase 7 large-file tests. The new runner supplements rather than replaces those checks.

## Rerun

Use the **existing** Playwright module and installed browser executables. No automatic installation takes place.

```sh
npm test
npm run check
npm run build
npm run preview -- --host 127.0.0.1 --port 4181 --strictPort
# In another terminal, with paths appropriate to this machine:
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chrome-headless-shell \
TEST_URL=http://127.0.0.1:4181 npm run test:compatibility
```

Default: Chromium, Firefox, WebKit, sequentially, the same fixtures and assertions. `BROWSERS=firefox` selects one engine; others are explicitly untested. Optional per-engine executable overrides: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, `PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH`, `PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH`. Existing `PLAYWRIGHT_EXECUTABLE_PATH` remains a **Chromium-only** fallback, never applied to Firefox/WebKit. Browser executables should match the installed Playwright version; Playwright Firefox/WebKit require their patched distributions.

Missing executables are recorded as untested, not test failures or successes. Other launch/configuration errors and assertion/conversion failures make the command fail. `REQUIRE_BROWSERS=1` also makes any untested route fatal (use this for fully provisioned CI). A missing Playwright module fails the command while preserving untested reports. Browser availability must be read alongside the exit code; a missing-browser-only run is not a compatibility pass.

Only local TEST_URL origins are accepted. Browser-context routing blocks and records non-GET and external HTTP requests, including worker requests. Service workers are disabled for a fresh network baseline. Local vendor assets remain available; no codec installation or remote conversion service is used. Restart preview after rebuilding to avoid stale hashed modules.

## Capability and results contract

`detectBrowserCapabilities()` in `src/lib/codec-registry.ts` reuses `detectEnvironment()` and adds secure context, isolation, Worker API, OPFS and Web Locks presence, plus constructor-probed gzip/deflate/deflate-raw compression/decompression support. `Analysis.browserCapabilities` publishes the actual **conversion worker** snapshot without changing UI state or cached verified outputs. No UA sniffing. API presence does not promise OPFS quota/write access, a working module worker, a supported codec/profile or available memory. Actual inspect/encode/decode probes remain authoritative. When worker inspection cannot complete, capabilities may be unavailable; this is not recorded as `false` support.

Every input records fixture, inspection time, actual supported destinations, codec descriptors, worker environment and any inspection error. Every baseline pair records status, error/reason, conversion time and, on success, output size/MIME, selected engines/fallback and streaming resource metadata where available. Browser reports include version, executable, source revision, Node/platform, timestamps, runtime errors and attempted external/upload requests.

Artifacts are overwritten on every run under ignored `artifacts/phase8.1/`:

- `chromium.json`, `firefox.json`, `webkit.json`: per-browser evidence.
- `results.json`: all three reports, including unavailable browsers.
- `matrix.md`: generated 134-route matrix and summary.

Published snapshots: [Compatibility Matrix](compatibility-matrix.md), [browser results](phase-8.1-results.json). The committed JSON removes repeated codec descriptors/capabilities and repeated launch banners; full evidence remains in raw artifacts. These are measured snapshots, not promises about future browser releases. Regenerate the artifacts and deliberately update the snapshots after reruns.

### Status definitions

| Status | Meaning |
|---|---|
| `passed` | Inspect advertised output; real UI conversion completed; downloaded bytes passed signature and category header/container validation, plus the production codec's existing output verification. Worker released and MorphSurface identity retained. |
| `unsupported` | Inspect succeeded but its real encoder probes did not advertise this output. It was **not attempted**, and is not a failed conversion. The underlying probe reason is not exposed by the existing inspect API; no specific cause is invented. |
| `failed` | A real fixture's inspection, advertised conversion, download, validation or lifecycle assertion failed. Decoder rejection of a known-valid fixture is a failure to investigate, not silently reclassified as unsupported. |
| `untested` | Browser/setup unavailable, explicitly not selected, or execution stopped before the pair. No support inference. |

Success rate = passed / (passed + failed); no attempts gives **null**, not 0% or 100%. Coverage = (passed + failed) / 134. Unsupported and untested counts always remain visible. Route milliseconds include selection, UI completion, download and validation; inspection milliseconds are separate. These small-fixture, sequential, local measurements are not throughput benchmarks or codec-only CPU time.

## Fixture reuse and validation limits

Reuses `swatch.{png,jpg,webp,avif,gif,tiff}`, all eight `audio/music.*` baseline inputs, `deflated.zip`, `sample.tar`, `sample.tar.gz`, `hello.txt.gz`. BMP and ICO bytes use the existing encoders (ICO embeds the existing PNG); safe static SVG follows the existing `tests/browser.mjs` pattern. No FFmpeg/browser download or regenerated audio corpus is needed.

Downloads are checked with existing `detectFormat`, `inspectFile`, `inspectAudioBytes` and `archiveCodec.inspect`. The production engines already re-decode and verify their outputs. This shared compatibility smoke matrix does **not** independently establish perceptual audio quality, exact pixels on every pair, all codec profiles, large-file performance, every archive member's equality, branded Chrome/Safari behavior, mobile or private browsing. Keep the deeper existing category suites and Phase 7 storage tests.

## Browser-dependent constraints

| Dependency / path | Constraint and interpretation |
|---|---|
| Worker images | Requires worker OffscreenCanvas, 2D context, createImageBitmap and output encoding. Main-thread API availability alone is insufficient. |
| PNG | Native encoder with existing single-thread PNG WASM fallback; missing WASM is reported in capabilities, not bypassed. |
| JPEG / WebP / conditional AVIF | Actual browser encoding **and output verification** decides support. AVIF input is not evidence of AVIF encoding. AVIF output is outside the existing 134 baseline. |
| BMP / ICO / TIFF | Existing bounded built-in codecs; still need worker pixel/canvas facilities. GIF remains single-frame input only; SVG remains the validated static input subset. |
| AAC / M4A | Native WebCodecs + existing Mediabunny demux/mux, codec/profile dependent. No native AAC means those outputs may be absent; no new WASM fallback. |
| MP3 / FLAC / Vorbis / Opus | Existing self-hosted single-thread libav WASM; requires WebAssembly and successful real output probes. No shared-memory/thread dependency added. |
| ZIP / TAR.GZ / GZIP | gzip/deflate(-raw) algorithm support matters, not just CompressionStream presence. Existing ZIP stored-record fallback and destination filtering remain. TAR is built-in. |
| Large output / temporary storage | Existing OPFS + Web Locks path is conditional on actual storage access. Small Blob fallback remains bounded at 64 MiB. This new small-fixture matrix does not validate every engine's large-file OPFS behavior. |
| Secure context / isolation | Record actual flags. Loopback verification is a secure-context environment; do not extrapolate to insecure hosting. Shared memory is optional for the present single-thread engines. |

## Measured verification — 2026-10-23

macOS ARM64, Node 26.0.0, production static preview at `127.0.0.1:4181`, tested conversion/runner commit `1b76781` (matrix-only capability rendering subsequently added and unit-tested in `ac72431`). Used the existing external Playwright module and Chromium headless-shell executable (revision 1248), explicitly overriding Playwright's absent default revision 1247. No downloads or environment installs.

| Engine | Result | Success / coverage | Conversion-time sum |
|---|---|---|---|
| Chromium 156.0.8078.4 | **134 passed**, 0 failed, 0 unsupported | 100% / 100% | 94,851 ms |
| Firefox | **134 untested**; expected `firefox-1553` executable absent | null / 0% | not measured |
| WebKit | **134 untested**; expected `webkit-2368/pw_run.sh` absent | null / 0% | not measured |

Chromium: all image destinations PNG/JPEG/WebP/BMP/ICO/TIFF, all eight audio destinations including native AAC/M4A, all four archive destinations. Native AVIF output was not advertised. Worker capability snapshot: WebAssembly/SIMD, OffscreenCanvas, imageBitmap, canvas encoding, AudioEncoder/Decoder, OPFS, Web Locks and gzip/deflate/deflate-raw compression/decompression present; secure context true, isolation/shared memory false. Runtime errors, external requests and upload attempts: **zero**. This does not verify OPFS quota or every codec profile in other browsers.

Observed checks:

- `npm test`: **110/110 passed**, including five new capability/status-accounting/matrix tests.
- `npm run check`: **0 errors, 0 warnings**.
- `npm run build`: static build passed.
- `npm run test:compatibility`: exit 0; Chromium 134/134, Firefox/WebKit explicitly untested (non-strict mode).
- `npm run test:phase6`: **26 real conversions**, TIFF pixel equality, AIFF decode/options, cancel/retry and worker/URL cleanup passed.
- `node tests/audio-lifecycle-browser.mjs`: cancellation, stale replies, cleanup, missing-WASM PCM fallback and simulated missing native AAC passed. Simulations are not Firefox/WebKit executions.
- `npm run test:static`: prerendered output, local WASM and notices passed.
- LSP tool returned no applicable TypeScript diagnostics; the actual type/Svelte check above is the verification used.

The first matrix run reported four TAR.GZ failures due to the **new harness**, not conversion: gzip magic identifies only GZIP, while TAR.GZ requires expanded-content inspection. Corrected that single assertion to expect the gzip wrapper, retaining the existing archive inspector's strict TAR.GZ content check. The full rerun passed all four. Initial evidence is retained in ignored `artifacts/phase8.1/initial-results.json`; final published snapshots contain the corrected run. No production conversion bug was established, so no speculative codec change was made.

Not rerun: the entire legacy image/UI motion suite, independent FFmpeg/SNR matrix and Phase 7 large-file RSS benchmarks. The common matrix plus focused Phase 6/audio lifecycle/static regressions bound this non-UI change. No browser installation, dependency changes, UI/MorphSurface changes, push or deployment.

## Findings and Phase 8.2 handoff

The measured summary above separates execution success from availability. Priority means verification/engineering priority, not a claim of an observed vulnerability.

1. **P1 — Firefox and WebKit evidence gap:** if unavailable locally, all 134 pairs stay untested. Provision matching existing Playwright browser distributions only with operator approval, then rerun with `REQUIRE_BROWSERS=1`. WebKit success alone will still not certify shipping Safari/iOS.
2. **P2 — broaden browser-specific storage/lifecycle checks:** adapt the existing Phase 7 large-file/cancel/quota suite once browsers are available; its Chromium-oriented OPFS instrumentation must not become a universal feature assumption.
3. **P2 — branded/mobile and profile coverage:** real Safari/iOS and Chrome builds, AAC availability/profile differences, private storage restrictions, larger/real-world media and independent output decoding. Retain exact failure reasons and capability snapshots before proposing codecs or UI changes.
4. **P3 — probe diagnostics:** existing inspect output filtering does not expose each rejected encoder's internal exception. Current reports say only “not advertised”; Phase 8.2 can add structured reasons if real browser failures justify it.

No speculative conversion fixes or new codecs are justified by missing-browser evidence. Major storage changes, browser installations and UI changes remain outside 8.1.
