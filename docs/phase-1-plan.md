# Phase 1 implementation plan

Goal: real, local PNG/JPEG/WebP conversions without changing MorphSurface or the existing visual language.

## Scope and boundaries

- `formats.ts`, `registry.ts`: format definitions/signatures, adapter registration, direct conversion planning. Adapter descriptors contribute formats and routes; lazy implementations run only in the worker. Plans contain steps, but multi-hop execution is deferred.
- `image-format.ts`: bounded file/header inspection before decoding. Reject MIME/extension conflicts, animation, malformed/truncated headers and unsafe dimensions. Native decoding validates compressed image data.
- `adapters/canvas-codec.ts`: native createImageBitmap + OffscreenCanvas, encoder capability probes, oriented thumbnail, white JPEG background, quality, real output verification.
- `conversion.worker.ts`, `engine.ts`: worker protocol and one-job scheduler. Stage notifications are indeterminate; abort/timeout/error always terminate the worker.
- `machine.ts`, `converter.svelte.ts`, `results.ts`: metadata readiness, stale-response guards, retained settings, real result and Blob URL lifecycle.
- `+page.svelte`, `layout.css`: replace demo data/actions, keep surface layout and DOM/animation implementation untouched.
- Existing machine, engine and browser tests are updated rather than discarded; new registry/header/result cases supplement them.

## Tasks

1. Write failing registry/detection tests; implement direct plans, real signatures and pre-decode bounds; run unit tests; commit.
2. Write scheduler/result tests; implement lazy worker codec, truthful stage reporting, cancellation and MIME verification; run unit/type checks; commit.
3. Extend state-machine tests for analysis/results/stale callbacks; integrate UI and download lifecycle; check/build; commit.
4. Update browser suite for all nine input/output pairs, transparency/white JPEG, EXIF, dimensions, quality, actual downloaded bytes, unsupported formats/encoders, memory budgets, worker termination/retry/races and existing interaction/motion/mobile checks. Run all required commands against production preview; inspect screenshots; fix regressions; commit tests/docs.

## Safety budgets

32 MiB encoded input; 8192 pixels per side; 16 million pixels; estimated working buffers (12 bytes/pixel plus twice the encoded input) <=256 MiB. One active worker per converter; bounded job lifetime; output <=64 MiB. No raw-file preview on the main thread: only a worker-produced thumbnail. No external requests or new dependencies. Browser decoder internals are not a hard OS memory sandbox.

## Verification focus

- Reject misleading extensions/MIME while allowing absent MIME/extension when content is recognized.
- Parse dimensions before native decoding; verify decoded and encoded dimensions/type again.
- Ignore late analysis/conversion responses after replacement, cancel, reset or destruction.
- Never present unimplemented routes, fabricated percentages or dummy results.
- Dispose workers, ImageBitmaps, canvases and Blob URLs on every exit path.
- Preserve source files/settings; normalize EXIF orientation once and strip original metadata in output.

No push or deployment. Physical devices, other browser engines and OS clipboard require separate manual verification if unavailable locally.
