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

## Measured verification — 2026-10-23, after approved browser installation

macOS ARM64, Node 26.0.0, production static preview at `127.0.0.1:4181`, tested implementation commit **`64caaa3`**. Final sequential run: 13:57:40–14:06:31 UTC. Existing external Playwright **1.64.0-alpha-1790635538000**, existing Chromium headless-shell revision 1248 (explicit executable override; default revision 1247 absent).

Firefox and WebKit were initially unavailable, then **installed with explicit user approval** using the existing Playwright CLI:

```sh
node /absolute/path/to/playwright/cli.js install firefox webkit
```

Downloaded Firefox revision **1553** (105.2 MiB) and WebKit revision **2368** (78.4 MiB) into the normal Playwright cache. No package installation, lockfile change, OS dependency installation or new service. The test runner itself still never installs browsers.

| Engine | Passed | Unsupported | Failed | Untested | Success / coverage | Conversion-time sum |
|---|---:|---:|---:|---:|---|---:|
| Chromium 156.0.8078.4 | **134** | 0 | 0 | 0 | 100% / 100% | 96,283 ms |
| Firefox 156.0 | **118** | **16** | 0 | 0 | 100% / 88.1% | 99,329 ms |
| WebKit 26.6 | **125** | **9** | 0 | 0 | 100% / 93.3% | 107,379 ms |

**377 passed + 25 unsupported = all 402 browser/route combinations accounted for.** All advertised routes succeeded; unsupported routes are not successes. Runtime errors, external conversion requests and upload attempts: **zero** across all three browsers.

| Browser-dependent observation | Evidence / constraint |
|---|---|
| Chromium | All 134 baseline routes available, including native AAC/M4A and all six image destinations. |
| Firefox | AAC and M4A **outputs** were not advertised for any of the eight audio inputs: 16 unsupported pairs. AAC/M4A **input decoding** and the other six audio destinations passed. AudioEncoder/AudioDecoder API presence did not guarantee AAC output support. No codec fallback was invented. |
| WebKit | WebP **output** was not advertised for any of the nine image inputs: 9 unsupported pairs. WebP input decoding and the other five image destinations passed. All 64 audio routes, including AAC/M4A, passed. |
| Chromium / Firefox storage | All 16 archive routes passed using actual OPFS outputs. |
| WebKit storage | In Playwright's non-persistent/private context, OPFS API was present but initial `getDirectory()` failed. After the bounded-fallback fix below, all 16 archive routes passed using **Blob** outputs, retaining the 64 MiB cap. This does not certify large-file OPFS behavior in shipping Safari. |

All three worker snapshots had WebAssembly/SIMD, OffscreenCanvas, ImageBitmap, canvas encoding, AudioEncoder/Decoder, OPFS and Web Locks APIs, plus gzip/deflate/deflate-raw constructors. Secure context true, isolation/shared memory false. Native AVIF output was not advertised (outside the baseline 134). Actual operational results, not these presence flags alone, determine compatibility.

### Verified compatibility fix

The first installed-WebKit run failed all **16 archive routes** with `Temporary disk output could not open`. A direct probe reproduced `navigator.storage.getDirectory()` rejecting with **UnknownError** in both window and worker of a non-persistent WebKit context; the same access succeeded in a temporary persistent context. The probe's temporary profile was removed afterwards.

`createOutput()` previously allowed the bounded Blob fallback only for NotSupportedError/SecurityError. The minimal fix additionally accepts **UnknownError before any temporary file has been registered**. It does not swallow quota/allocation failures or UnknownError after file registration; write/finalize errors and cleanup behavior are unchanged. A new regression test proves exact Blob bytes, the retained size bound, and continued rejection of quota/allocation failures. No new codec or storage backend was added.

The full three-browser strict-mode rerun passed all supported pairs after the fix. Pre-fix evidence remains in ignored `artifacts/phase8.1/pre-webkit-fix-results.json`; committed snapshots are the final post-fix run.

### Observed checks

- `npm test`: **111/111 passed**, including the new inaccessible-OPFS regression.
- `npm run check`: **0 errors, 0 warnings**.
- `npm run build`: static build passed; preview restarted before browser rerun.
- `REQUIRE_BROWSERS=1 npm run test:compatibility` (with module/executable/URL overrides above): **exit 0**, all three engines executed, no untested or failed routes.
- `npm run test:phase7`: **exit 0 after the fix** — 96 MiB archive streaming, independent Python byte integrity, OPFS/Blob/quota/OOM, cancellation/create race/retry/cleanup, 10-minute PCM, same MorphSurface and no uploads. This confirms the ordinary Chromium disk path still works.
- Earlier Phase 8.1 checks: Phase 6's **26 real conversions**, TIFF pixel equality, AIFF options/cancel/retry; audio lifecycle; static output/assets/notices all passed. Their capability simulations were not counted as real Firefox/WebKit coverage.
- LSP tool returned no applicable TypeScript diagnostics; the actual type/Svelte check above is the verification used.

An earlier harness-only issue treated TAR.GZ's gzip magic as the final format. That assertion was fixed while retaining expanded-content validation; initial evidence remains in ignored `artifacts/phase8.1/initial-results.json`.

Not rerun: the entire legacy image/UI motion suite, independent FFmpeg/SNR matrix and peak-RSS benchmarks. No UI/MorphSurface changes, new formats/WASM, project dependencies, push or deployment.

## Findings and Phase 8.2 handoff

Priority means verification/engineering priority, not a claim of an observed vulnerability.

1. **P1 — resolved: WebKit private-context archives unusable.** Initial OPFS UnknownError now uses the existing bounded Blob fallback. All 16 archive routes passed after the fix; large outputs still stop at the documented 64 MiB fallback limit.
2. **P2 — known output limitations:** Firefox AAC/M4A (16 pairs) and WebKit WebP (9 pairs) remain unsupported by actual output probes. Keep destinations hidden; do not claim success or add a large WASM engine to mask these limits in 8.1. More specific structured rejection reasons can be investigated in 8.2.
3. **P2 — storage/lifecycle coverage:** test persistent-context WebKit storage, private-mode size-limit rejection, real Safari/iOS and cross-tab cleanup using the existing Phase 7 cases. The successful Chromium Phase 7 test does not certify Firefox/WebKit large-file behavior.
4. **P2 — branded/mobile/profile coverage:** shipping Safari/iOS and branded Chrome, varied AAC profiles, larger/real-world media and independent output decoding remain unverified. Playwright WebKit/Firefox builds are not a substitute for every shipping browser/device.
5. **P3 — probe diagnostics:** inspect output filtering currently exposes only “not advertised,” not each rejected encoder's internal exception. Add structured reasons only where actual failures justify it.

The original missing-browser gap is closed on this machine. All 134 canonical routes remain available in Chromium, and all three engines have real fixture evidence. Major storage changes, new codecs and UI changes remain outside 8.1.
