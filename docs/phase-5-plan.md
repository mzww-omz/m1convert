# Phase 5 implementation plan

Goal: a working, small codec-engine registry shared by browser-native, WebCodecs and multiple independent WASM codecs; preserve the existing UI and validated conversion routes.

Execute inline with tests first. Keep adapter routing (`registry.ts`) and Worker scheduling (`scheduler.ts`) rather than replacing them.

## Scope / boundaries

- No server conversion, push or deploy; preserve MorphSurface, cancellation/deadlines, input validation and Phase 4 safety budgets.
- Use pinned `@jsquash/png` for a real second single-thread WASM engine alongside existing LGPL libav. Evaluate but do not register unimplemented FFmpeg.wasm/wasm-vips engines.
- No general multi-hop graph, plugin discovery, UI engine picker, new file formats or threaded-WASM requirement.

## Steps

1. **Registry and capabilities**
   - Add `src/lib/codec-registry.ts`: typed generic engine definitions, serializable capabilities, feature detection, deterministic candidate selection, lazy loading, typed recoverable/unrecoverable failures, AbortSignal and per-attempt verification.
   - Add `tests/codec-registry.test.mjs`: environment/options filtering without loading, success, ordered recoverable fallback, terminal validation/resource errors, failed loaders, pre/during abort, cleanup before fallback, exhausted errors.
   - Run focused tests and commit.
2. **Real engines / migration**
   - Add lightweight engine descriptor modules under `src/lib/engines/`; implementations stay lazily imported. Move built-in image encoding without changing output semantics.
   - Migrate image encoding to native Canvas / built-in / PNG WASM selection, preserving structural and actual output decode verification.
   - Migrate audio decode/encode selection to built-in PCM, WebCodecs AAC and libav WASM over the existing PCM representation. Keep container validation outside selection and mux/demux where the library requires it.
   - Publish capabilities in worker analysis and selected engine IDs in results, without rendering a new UI.
   - Pin/copy local PNG WASM assets with provenance/license records and a reproducible sync script. No CDN and no eager WASM.
   - Run real codec, capability, lazy-asset and existing tests; commit in bounded units.
3. **Browser verification / docs**
   - Add `tests/phase5-browser.mjs`: native success, real PNG-WASM fallback, fallback verification failure, blocked engine load, Cancel during WASM loading, no threads/isolation, no initial WASM fetch, no uploads, Worker/URL cleanup and persistent DOM.
   - Run Node tests, typecheck, build and existing image/archive/audio/checking browser suites sequentially.
   - Document architecture/API extension steps, capability limitations, engine evaluation (licenses, package/runtime sizes, compatibility and measured local timings), deployment/replacement assets, remaining limits; commit.

## Review focus

- A corrupt/unsafe source must fail before fallback; do not turn structural failures into compatibility failures.
- An encoder fallback must preserve requested format/options and pass the same output verification.
- Abort/resource errors must not start another expensive engine; terminate Worker even during module loading.
- Capability metadata is conditional, not a claim that every file/configuration will succeed; exact native configuration checks and real probes remain.
- Optional WASM cannot become an initial-page, mandatory-thread or mandatory-CDN dependency.
