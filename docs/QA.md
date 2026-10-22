# Phase 0 verification

Verified on 2026-10-22 with Node 26 and local headless Chromium (macOS ARM64). No dependency or browser download was performed.

## Results

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 8 passed, 0 failed.
- `npm run build`: passed. Adapter-auto has no production platform configured; deployment is out of scope.
- `TEST_URL=http://localhost:4174 npm run test:browser` with the existing Playwright/browser paths: passed against the production preview.
- `git diff --check`: passed.

Browser coverage: all four states; error and retry; cancel and re-convert preserving settings; new/change/remove file; keyboard picker and focus; browser-dispatched drop/paste; repeated clicks, rapid input replacement and cancellation during morphing; native image preview and corrupt-image recovery; object URL reuse; 320px, 375px, 768px, 1024px and 1280px widths; reduced motion; emulated touch. No page errors or external HTTP requests were observed.

A regression test first reproduced unnecessary preview URL recreation on settings changes, then passed after the selected file became a stable derived dependency. A second test reproduced page-chrome movement on image preview, then passed after reserving desktop surface space.

## Motion

Production-preview rAF sampling over an Upload → Details transition:

| Measurement | Observed |
| --- | ---: |
| Frames sampled | 56 |
| Median frame interval | 16.7ms |
| 95th-percentile interval | 16.8ms |
| Distinct intermediate widths | 10 |
| Horizontal / vertical center drift | <0.008px |

This confirms physical dimension interpolation and approximately 60fps in this environment. It does not establish performance on every device or under heavy native image decoding.

## Visual artifacts

Generated, untracked screenshots in `artifacts/` were inspected for clipping, alignment and overflow:

- `upload.png`, `details.png`, `progress.png`, `complete.png`
- `error.png`, `image-details.png`
- `mobile-upload.png`, `mobile-details.png`, `mobile-progress.png`, `mobile-complete.png`
- `motion-metrics.json`: measured intervals and geometry.

## Not verified / remaining work

- Real conversion, output sizes and downloads are deliberately not implemented. Format choices are UI examples.
- Safari, Firefox, physical touch devices and screen-reader software were not exercised.
- Clipboard/drop tests dispatch browser file events; actual OS clipboard and Finder drag integration need manual checks.
- The 5GB case verifies metadata-only behavior using a synthetic file size, not a real 5GB allocation or disk file.
- Image previews cap encoded size at 20 MiB but not decoded pixel count. An isolated decoding/pixel budget should accompany production file analysis.
- No push, deployment or external service was used.
