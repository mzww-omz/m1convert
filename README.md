# Convert — Phase 0

Minimal appearance, fluid interaction. A local-only conversion **UI demo**, built with the existing Svelte 5, TypeScript, SvelteKit and Vite setup. No conversion engine, upload, external API, CDN or new dependency.

## Run

```sh
npm run dev
```

Open the local Vite URL. Select, drop or paste one file. Choose an example output format, then **Convert** to run the demo. **Download** is intentionally disabled: no converted file exists. Convert Again and Cancel retain the input and settings; New File clears them.

For a reproducible error and retry, open `/?demo=error`. The first demo run fails; Try again completes. This parameter never changes file contents.

## Implementation

- `src/lib/machine.ts`: explicit, pure state machine; invalid transitions and stale asynchronous callbacks are ignored.
- `src/lib/converter.svelte.ts`: reactive state and cancellable engine lifecycle, separate from rendering.
- `src/lib/engine.ts`: abortable demo implementation and future conversion request/result interface. A real engine and result-download handling remain future work.
- `src/lib/MorphSurface.svelte`: one persistent outer element, measured content height, interruptible 100ms exit / 320ms resize / 180ms entrance. Text never scales. Reduced motion removes transitions and staging delays.
- `src/routes/+page.svelte`: input methods, settings and four states, with error recovery and focus management.
- `src/routes/layout.css`: monochrome UI, desktop center anchoring and mobile top anchoring.

The single box intentionally animates width and height rather than scaling its contents. Content is laid out at its destination width while hidden; a ResizeObserver tracks its height. Desktop space is reserved for previews to keep surrounding elements still.

Files stay in browser memory. Image preview uses a revocable object URL and native asynchronous decoding for PNG, JPEG, WebP, GIF and AVIF up to 20 MiB. Other files still show metadata and demo settings immediately. No text parsing or full-file reads take place; SVG is not rendered, avoiding embedded external resources. Native image decoding is not a guarantee against unusually large decoded images; a worker-based preview budget can be added with the real analysis pipeline.

Output formats and settings are illustrative, not a supported-conversion list. Multiple-file drops select the first file and say so. During progress, new files are ignored until Cancel.

## Checks

Node 22.18+ (native TypeScript stripping) is required for the unit test command.

```sh
npm test
npm run check
npm run build
```

Browser tests use an **existing** Playwright installation and Chromium; nothing is downloaded automatically. With Vite running:

```sh
npm run test:browser
```

If Playwright is installed outside this repository, point to its `index.mjs`:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
PLAYWRIGHT_EXECUTABLE_PATH=/absolute/path/to/chromium \
TEST_URL=http://localhost:5173 \
npm run test:browser
```

The browser suite covers all states, retry, cancellation, repeated input during morphing, file chooser, browser-dispatched file paste/drop, preview errors, retained settings, preview URL reuse, 320px/tablet/desktop resizing, reduced motion, keyboard focus and emulated touch. It checks persistent frame identity, intermediate frame geometry, desktop center stability, page errors and external HTTP requests.

Screenshots and measured frame intervals are written to ignored `artifacts/`. The 5GB-file case uses metadata without allocating a 5GB payload. OS clipboard integration, real multi-gigabyte files, physical mobile devices, screen readers, Safari and Firefox still need manual verification. Local Chromium frame timings are evidence for that environment, not a universal 60fps guarantee.
