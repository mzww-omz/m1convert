# Phase 8.2  Large-file and storage compatibility

## Scope

This phase verifies storage behavior beyond Phase 8.1's 134-route small-fixture matrix. It adds no format, codec, service, UI feature, upload, or larger memory allowance.

The new regression test is tests/phase8-2-browser.mjs (npm run test:phase8.2). It creates a deterministic 68 MiB TAR payload, executes the real TAR -> TAR browser UI conversion, downloads successful outputs, and independently checks the TAR member size and SHA-256 of every payload byte. The size intentionally exceeds the existing 64 MiB bounded Blob fallback budget.

Each selected engine runs in a new non-persistent Playwright context. WebKit additionally runs in a separate temporary persistent context. These Playwright contexts are not an emulation of Safari's official Private Browsing mode. Reports are written under ignored artifacts/phase8.2/; source bytes and the isolated persistent profile are deleted on exit.

## Measured results  2026-10-23

Ubuntu 24.04 amd64, Node 24.18.1, Playwright 1.64.1, static loopback preview; starting source revision 5726f48. All four cases passed:

| Browser / context | Version | Initial OPFS directory access | Large-file outcome | Test |
| --- | --- | --- | --- | --- |
| Chromium / non-persistent | 156.0.8078.4 | Yes | Disk-backed OPFS output | PASS |
| Firefox / non-persistent | 157.0 | Yes | Disk-backed OPFS output | PASS |
| WebKit / non-persistent | 27.2 | No (UnknownError) | Safe 64 MiB Blob-cap rejection, then small-file Blob retry succeeds | PASS, expected limit |
| WebKit / persistent | 27.2 | Yes | Disk-backed OPFS output | PASS |

For all three successful large outputs:

- The worker reported 71,304,704 output bytes, mode=opfs, retainedBytes=0, maxChunkBytes=65536.
- Downloaded TAR payloads independently matched the generated SHA-256 and 68 MiB member size.
- A second tab in the same browser context observed the completed, leased temporary output.
- After Convert Again, the second tab observed its removal.
- Browser page errors, external HTTP requests and non-GET/upload attempts were all zero.

WebKit's non-persistent context returned UnknownError at OPFS access as in Phase 8.1. Its 68 MiB conversion reached the explicit 64 MiB Blob limit, then recovered and downloaded a small TAR via Blob fallback. This is a passing limit-and-recovery check, not a successful large-file conversion.

All browsers were really launched. Feature presence alone was not counted as working storage. Peak browser heap/RSS was not measured; retainedBytes and maxChunkBytes are only application-level counters.

## Reproduce

Install project dependencies plus a matching Playwright module and browser binaries on the host. The test runner does not download browsers; Playwright is not a pinned project dependency. The measured Linux host used Playwright 1.64.1 and its Chromium, Firefox and WebKit distributions, plus Linux WebKit dependencies.

In terminal 1:

    npm run build
    npm run preview -- --host 127.0.0.1 --port 4181 --strictPort

In terminal 2:

    TEST_URL=http://127.0.0.1:4181 npm run test:phase8.2

Optional browser subset:

    BROWSERS=firefox TEST_URL=http://127.0.0.1:4181 npm run test:phase8.2

An external Playwright module may be selected via PLAYWRIGHT_MODULE. The preview URL must be loopback; browser routing records and aborts non-GET and external HTTP requests. Browser launch errors are failures, not silent passes.

## Limits and next verification

- These four cases do not rerun or extend the existing 134-route matrix. Phase 8.1 remains the format-route compatibility evidence.
- Playwright WebKit is not shipping desktop/mobile Safari. Real Safari/iOS, Chrome, actual private browsing, site-data eviction and storage quotas remain unverified.
- Only TAR -> TAR large output is new cross-engine coverage. Phase 7's other large archive formats, quota/OOM, cancellation and long-audio scenarios remain Chromium-only.
- Cleanup is cross-tab within one context, not across separate profiles, crashes or process termination.
- Media codec profiles, independent perceptual quality, large video, and browser peak memory usage are untested.

Next: Safari/iOS hardware coverage; larger compressed inputs and cancellation in Firefox/WebKit; quota/eviction recovery; independent media output validation. Do not relax the Blob cap based on these results.
