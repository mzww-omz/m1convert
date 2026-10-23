# Phase 8.3 - cross-browser large-archive and long-audio verification

## Scope

Phase 8.3 adds regression coverage, not formats or codec routes. The existing **134 baseline format pairs** and MorphSurface remain unchanged. The runner is `tests/phase8-3-browser.mjs` (`npm run test:phase8.3`).

On a local static preview it generates one deterministic **68 MiB payload**, packages it independently with Python's ZIP/Deflate and USTAR+gzip writers, then uses the real Convert browser interface to create TAR output. Both compressed input files exceed the historical 32 MiB file-input limit; the decoded TAR output exceeds the separate **64 MiB in-memory Blob fallback** limit. Successful TAR downloads are checked independently with a streaming SHA-256 of the complete payload, file name, recorded member length and archive length. The payload SHA-256 in this run is `04dc90234ac2ea0db17b61dd07935690d12c3b923bc5162e989f9737ac2c1840`.

The runner also converts a ten-minute mono PCM16 WAV into AIFF and independently compares the decoded PCM SHA-256 of both files using host FFmpeg. It checks immediate cancellation of a large ZIP conversion, Worker termination, and (where accessible) removal of temporary OPFS outputs. A successful large result must report `mode=opfs`, `retainedBytes=0` and `maxChunkBytes<=65536`; no output byte count alone is treated as proof of validity. External HTTP calls, uploads and page errors fail the run. Everything is local: no files are sent to a server.

## Measured results - 2026-10-23

Ubuntu 24.04 amd64; Node 24.18.1; Playwright 1.64.1 with Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2. The preview was served at `http://127.0.0.1:4181`. Each WebKit large-archive case was additionally isolated in its own browser context to avoid conflating successive large memory/storage operations on this 4 GiB host.

| Engine / context | ZIP (68 MiB) | TAR.GZ (68 MiB) | Ten-minute WAV -> AIFF | Cancel / cleanup |
| --- | --- | --- | --- | --- |
| Chromium / non-persistent | PASS, full OPFS output/hash | PASS, full OPFS output/hash | PASS, independent PCM | PASS |
| Firefox / non-persistent | PASS, full OPFS output/hash | PASS, full OPFS output/hash | PASS, independent PCM | PASS |
| WebKit / non-persistent | PASS, **bounded 64 MiB output rejection** and small retry | PASS, **bounded 64 MiB input-analysis rejection** and small retry | PASS, independent PCM | PASS |
| WebKit / persistent | PASS, full OPFS output/hash | PASS, full OPFS output/hash | PASS, independent PCM | PASS |

Both WebKit non-persistent cases reported `UnknownError` at initial OPFS access. ZIP metadata was inspectable, but its large TAR output could not use the 64 MiB Blob fallback. TAR.GZ needed to expand while inspecting the source, and safely hit the fallback limit before it could offer a route. Neither is counted as a successful large-file conversion. Both recovered with a separate small TAR input, downloaded successfully, and remained usable for long audio and cancellation.

The WebKit persistent ZIP and TAR.GZ cases were verified in separate runs, as were the two non-persistent cases. This distinction is deliberate: passing cases do not imply that a sequence of multiple very large jobs has a bounded browser peak RSS, especially under temporary storage constraints.

## Reproduce

Prerequisites: project dependencies, Python 3, FFmpeg, the matching installed Playwright module and Chromium/Firefox/WebKit browser distributions. The test runner never installs browsers or fetches dependencies. Run a **fresh build and preview** after source changes.

Terminal 1:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4181 --strictPort
```

Terminal 2:

```sh
TEST_URL=http://127.0.0.1:4181 npm run test:phase8.3
```

On constrained hosts, run engines and WebKit contexts separately:

```sh
BROWSERS=chromium TEST_URL=http://127.0.0.1:4181 npm run test:phase8.3
BROWSERS=firefox TEST_URL=http://127.0.0.1:4181 npm run test:phase8.3
BROWSERS=webkit WEBKIT_CONTEXT=temporary ARCHIVES=ZIP TEST_URL=http://127.0.0.1:4181 npm run test:phase8.3
BROWSERS=webkit WEBKIT_CONTEXT=temporary ARCHIVES=TAR.GZ TEST_URL=http://127.0.0.1:4181 npm run test:phase8.3
BROWSERS=webkit WEBKIT_CONTEXT=persistent ARCHIVES=ZIP TEST_URL=http://127.0.0.1:4181 npm run test:phase8.3
BROWSERS=webkit WEBKIT_CONTEXT=persistent ARCHIVES=TAR.GZ TEST_URL=http://127.0.0.1:4181 npm run test:phase8.3
```

The runner writes ignored JSON reports under `artifacts/phase8.3/`, records each untested/failed state honestly and deletes generated large source bytes on normal exit. `ARCHIVES` is a targeted subset switch, not evidence of other archive cases.

## Remaining limits

- Playwright WebKit is **not** shipping desktop or iOS Safari. Real Safari, iPhone/iPad, actual private browsing, mobile storage pressure, and release Chrome remain untested.
- Actual quota exhaustion, eviction of site data, storage permissions after crashes, process termination cleanup and browser peak RSS/heap still need independent verification. The previous Phase 7 quota injections and unit tests do not substitute for actual quota/eviction behavior on each engine.
- Only ZIP/Deflate and USTAR+gzip **input -> TAR output** were newly checked at large sizes; other archive directions and compressed structures are not implied. These large source fixtures repeat a deterministic block, and cannot stand in for every real archive.
- Long audio is one 10-minute mono PCM16 WAV -> AIFF lossless case, not general proof of AAC/MP3/Opus quality, codec profiles, or multi-hour performance.
- These results neither relax the 64 MiB Blob cap nor increase support claims. Keep Phase 8.1's 134-route matrix and Phase 8.2's OPFS evidence as separate measurements.
