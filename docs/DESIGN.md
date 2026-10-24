# Convert UI

A compact, white, macOS-style utility. The workflow—not explanatory copy—is the interface.

- Keep the header to a small conversion mark, Convert and mzww.net.
- One persistent MorphSurface owns upload, details, progress, complete and error. Keep its ResizeObserver, width/height transition, focus handoff and Reduced Motion behavior.
- Use system fonts, neutral 1px borders and 4–6px radii. No gradients, decorative shadows, external fonts or icon CDN.
- Local Material Symbols Sharp SVGs live in `static/icons/`, with Apache-2.0 attribution. `IconButton` supplies an accessible name, associated hover/focus tooltip, Escape dismissal and a 44px target. Icons are decorative to assistive technology.
- Ready shows only input identity, size, actual output choices and Convert. Quality, sample rate, channels, bitrate, compression and source frame remain available through Settings.
- Main operations use dark fill: Convert in Ready, download in Complete. Secondary operations share the same icon-button treatment.
- Do not hide compatibility warnings, analysis failures, quality-loss warnings or recovery. Keep engine errors verbatim; only collapse implementation explanations and optional controls.
- Batch audio is one real ZIP download, not imaginary per-file download buttons. Other multi-file selections retain the existing first-file conversion behavior, visibly explained in Ready. Add/remove must use the existing LOAD lifecycle, not a separate conversion queue.
- Preserve native button/select/range keyboard behavior, focus rings, 320px layouts, readable long names, truthful progress and resource release.

Run `npm run test:utility` with the existing Playwright module/executable environment. `BROWSER=firefox` or `BROWSER=webkit` selects an installed patched browser. See [UI redesign and verification](ui-redesign.md) for scope and observed results.
