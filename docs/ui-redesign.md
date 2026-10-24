# Compact utility UI

## Scope and plan

Convert is a finished browser-local image, audio and archive converter. Users select or drop files, choose an actual supported output, convert and download. Recovery is retry, return to settings, replace or remove input. Keep the Svelte state machine, Converter, registry (134 conversion routes), workers, result ownership and MorphSurface node/lifecycle intact.

1. Introduce only the Material Symbols Sharp SVGs used by the UI, with local attribution, and keyboard/focus tooltips.
2. Restyle the existing page as a compact white macOS-style utility. Collapse advanced controls, not capabilities. Preserve important warnings and exact engine errors. Show batch inputs and allow real add/remove actions via existing LOAD events.
3. Update browser tests for progressive disclosure and add desktop/mobile state, tooltip and batch interaction coverage. Run unit, type, build and existing browser suites; inspect captures, fix defects and rerun.
4. Commit assets, UI and verification in logical units. No push/deployment.

## Direction contract

THESIS: One small working surface, not a landing page. File → output → Convert → download, with no repeated headings or instructional blocks.

OWN-WORLD: White, system font, 1px neutral borders, 4–6px corners, no shadows or gradients. 20px Sharp glyphs; dark fill identifies only the primary operation. Native controls retain their semantics.

STORY: First-time visitors see file-add and a short drop/click cue. Selection reveals the name, size and output selector; settings expand on demand. Progress is accurate or indeterminate. Completion leads to download; failure gives a concrete reason and recovery.

FIRST VIEWPORT: A narrow single-row header above a centered square upload Surface. Ready expands to a compact file list and one action row. Mobile keeps the same order and usable 44px touch targets. MorphSurface width/height animation is the signature interaction; its DOM identity is stable.

FORM: User-pinned macOS utility direction, code-led; no alternate visual direction or dependency required. Audio batches retain the existing sequential ZIP behavior; other batches explicitly identify the existing first-file-only behavior.

FINISH: Inspect desktop/mobile captures for every phase and expanded settings; verify actual downloads, cancel, retry, focus, reduced motion, no overflow, DOM identity, workers and object URL cleanup. Record observed results and any untested scope here.

## Verified results (2026-10-24)

Implementation: `3bad5dd`; browser harness updates: `5bc5f9e`. No conversion engine, state machine, codec registry or dependency was changed.

- `npm test`: 111 passed, 0 failed/skipped.
- `npm run check`: 0 errors, 0 warnings. No Svelte LSP route was available; this is the project's Svelte/TypeScript check.
- `npm run build` and `npm run test:static`: passed; static export and existing local codec/redistribution assets verified.
- `BROWSERS=chromium node tests/compatibility-browser.mjs`: 134/134 real conversion routes passed, 0 failed or unsupported. Firefox/WebKit's complete 134-route matrices were not rerun for this UI change.
- `node tests/browser.mjs`: passed image roundtrips, quality changes, all EXIF orientations, validation, actual Cancel, retry, input methods, touch emulation, DOM identity, no worker/object-URL leaks, no external requests/uploads. Final morph measurement: 9 intermediate widths, 0.0078125px horizontal/vertical center drift, 16.7ms median / 16.8ms p95 frame interval. These are local measurements, not general performance guarantees.
- `node tests/categories-browser.mjs`: passed 16 archive routes, audio settings, real ZIP batch, actual audio/archive cancellation, resource release and mobile checks.
- `node tests/audio-browser.mjs` and `node tests/audio-lifecycle-browser.mjs`: passed 64 audio routes with independent FFmpeg decode/SNR/bitrate checks, metadata removal, settings, batch, measured progress, WASM initialization/encoding Cancel and capability-failure recovery.
- Existing `checking`, `phase4`, `phase5`, `phase6`, `phase7` browser suites: passed, including 26 Phase 6 conversions, large images, genuine fallback, 96 MiB archive streaming, quota/OOM recovery, OPFS leases, cancellation races and ten-minute PCM.
- `BROWSERS=firefox,webkit TEST_URL=http://localhost:5173 node tests/phase8-2-browser.mjs`: passed Firefox private, WebKit private and WebKit persistent-profile storage/recovery checks. Chromium's default browser revision is unavailable to that script (which has no executable override); its storage lifecycle was exercised by Phase 7 instead.
- `BROWSER=<chromium|firefox|webkit> node tests/utility-browser.mjs`: all passed, using Chromium 155.0.8059.85, Firefox 156.0 and WebKit 26.6. Desktop 1280×900 and mobile 320×740 captures cover Idle, Ready, Settings, Processing, Error, Complete, batch Ready and batch Complete. Also checks real file-picker append, individual removal/focus, first-file promotion for non-audio, real batch ZIP contents, tooltips/Escape/clipping, 44px targets, local SVG loading, long names, Reduced Motion, validation recovery and unchanged Surface identity.
- Screenshot review: two inspection rounds. Fixed scroll-list tooltip clipping, restored focus after individual deletion, expanded a lone advanced field to full width and shortened redundant completion copy. Final captures were inspected for desktop/mobile and Firefox/WebKit native-control differences; no remaining visual blockers observed.
- Mechanical UI detector: no findings (`[]`).

The new UI regression test first failed on the missing Settings button, then passed after implementation. A test expectation was corrected to match the engine's existing numbered ZIP filenames, not by changing output names. A parallel final image-suite run exceeded the shell's 180-second deadline; its isolated rerun completed successfully with a 300-second allowance.

### Reproduction and artifacts

Use the existing external Playwright installation, without installing dependencies or browsers:

```sh
export PLAYWRIGHT_MODULE=/Users/agemizu/.pi/agent/npm/node_modules/playwright/index.mjs
export PLAYWRIGHT_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export TEST_URL=http://localhost:5173
npm run test:utility
BROWSER=firefox npm run test:utility
BROWSER=webkit npm run test:utility
```

`artifacts/utility/{chromium,firefox,webkit}/` contains full-page and Surface captures for all eight views. Existing suites write their usual `artifacts/phase1`, `artifacts/audio`, `artifacts/continuous` and phase-specific reports. Generated artifacts are gitignored. The only new assets are 15 local Sharp SVGs and their license/source attribution.

Not checked: physical mobile devices, VoiceOver/other screen readers, actual Safari, a formal WCAG audit, or deployment behavior. Browser mobile/touch and keyboard checks are not substitutes for those. No package installs, pushes or deployments were performed.
