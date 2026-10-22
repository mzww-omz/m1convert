# Checking latency optimization

Measured 2026-10-22 on existing Chromium 156.0.8078.4 / macOS ARM64, production preview. The benchmark times actual inspect request→analysis reply, excluding MorphSurface transitions. Inputs: existing 128×80 PNG and two-second audio fixtures. Full source validation, preview generation and conversion-result validation remain enabled.

## Cause

Each job intentionally terminates its worker to release native/WASM resources. Encoder probe results were memoized only inside that disposable worker, so each new file repeated actual encode/mux/decode probes for every destination. For the WAV fixture, reading/validating PCM took a few milliseconds, while repeated destination probes accounted for most of Checking time. Native AAC probes also ran only after the independent WASM probe group finished.

## Change

- Keep only **successful encoder format IDs**, separated into image/audio, in the owning engine's page-lifetime memory. Pass a plain snapshot to each fresh analysis worker; no user files, previews, PCM buffers, WASM heaps, workers or Blob URLs are retained by this cache.
- Reuse those proven destinations and probe only unknown/previously unsuccessful formats. Failure is not remembered as permanent lack of support. Reload/new engine starts fresh.
- A non-cancellation inspection/conversion error clears remembered capabilities, so subsequent analysis re-probes changed/broken resources. Cancel/stale results neither seed capabilities nor discard earlier successful probes.
- Run the independent WASM and native AAC probe groups concurrently on first audio analysis. Individual WASM probes remain sequential because they share one in-memory codec filesystem. Skip the optional native bridge entirely when native AudioEncoder/AudioDecoder APIs are absent.
- Continue validating and fully decoding **each input**, and validating/re-decoding **every actual output**. The cache does not assert that an arbitrary source codec, bitrate, sample rate or file is supported. Those checks still happen normally. A resource that becomes unavailable after a successful probe causes a real conversion error and cache invalidation, never a fake encoded file.
- Worker termination on success/error/Cancel/deadline remains unchanged. No persistent browser storage, new dependency, background worker, UI redesign or artificial delay.

## Local measurements

| Inspect time | Before | After |
| --- | ---: | ---: |
| First audio (WAV, cold discovery) | 513 ms | 396 ms |
| Further WAVs | 224–270 ms | **16–18 ms** |
| MP3 after audio discovery | 189–214 ms | **87–128 ms** |
| Further PNGs | 37–42 ms | **20–22 ms** |

Warm WAV inspection improved by approximately **93%** in this paired run. First PNG was 91 vs 100 ms (normal cold-run variation); this change principally targets repeated capability work. First-time codec downloads/initialization and real large-file decode/validation costs remain. These are local observations, not latency guarantees on other devices/networks.

Artifacts: ignored `artifacts/checking/before.json` and `after.json`, including stage times and the capability snapshots crossing workers. Warm WAV regression asserts equal supported destinations, no new `/vendor/` requests and faster analysis than first audio discovery. `npm run test:checking` uses the existing Playwright/browser environment variables; `EXPECT_CACHE=0 BENCH_LABEL=before` supports measuring older builds without cache assertions.

A repeat verification run measured warm WAV at 14/14 ms, warm PNG at 9/9 ms, MP3 at 150/95 ms and first audio at 415 ms (`verified.json`). Variation in cold startup is expected; the avoided work is confirmed by capability snapshots and zero new vendor requests on warm WAV analysis.

Final verification: **69 Node tests passed**, Svelte/TypeScript 0 errors/warnings, production build passed, `test:checking` passed, and image / archive / all 56 audio-pair browser suites passed (126 total format pairs retained). Regression checks cover independent category caches, failed-resource invalidation/recovery, no negative caching, abort/stale suppression, actual blocked-WASM PCM fallback and native-AAC absence. Worker/URL cleanup and full input/output validation remain tested. Optional LSP routes were unavailable; the actual type gate is `npm run check`. Firefox/Safari and physical devices are not newly verified by this optimization.
