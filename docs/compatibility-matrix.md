# Phase 8.1 — measured compatibility matrix

Generated from the same 134 fixture routes. WebKit is not shipping Safari; Chromium is not branded Chrome.
passed = downloaded and validated; unsupported = inspect succeeded but output was not advertised; failed = inspection/conversion/assertion failed; untested = browser/setup unavailable.
Success rate = passed / (passed + failed); coverage = attempted / 134. API presence does not guarantee codec or storage operation.

| Browser | Version | Passed | Unsupported | Failed | Untested | Success rate | Coverage | Conversion ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| chromium | 156.0.8078.4 | 134 | 0 | 0 | 0 | 100.0% | 100.0% | 94851 |
| firefox | — | 0 | 0 | 0 | 134 | — | 0.0% | 0 |
| webkit | — | 0 | 0 | 0 | 134 | — | 0.0% | 0 |

## Worker capabilities (presence, not operational guarantees)

| Capability | chromium | firefox | webkit |
|---|---|---|---|
| OffscreenCanvas | present | untested | untested |
| ImageBitmap | present | untested | untested |
| WebAssembly | present | untested | untested |
| AudioEncoder | present | untested | untested |
| AudioDecoder | present | untested | untested |
| OPFS API | present | untested | untested |
| Web Locks API | present | untested | untested |

## Browser-dependent constraints

| Paths | Constraint |
|---|---|
| Images | Worker OffscreenCanvas + ImageBitmap required. JPEG/WebP/conditional AVIF depend on actual native encoding and verification; AVIF output is outside the baseline 134. |
| AAC / M4A | Native WebCodecs codec/profile support required; no new WASM fallback. |
| MP3 / FLAC / Vorbis / Opus | Existing local single-thread WASM; shared memory/isolation not required. |
| ZIP / TAR.GZ / GZIP | Per-algorithm compression support required; ZIP can use existing stored-record fallback. |
| Large output | Actual OPFS + Web Locks/storage access is conditional; Blob fallback is bounded at 64 MiB. Small-fixture success does not validate large-file storage. |
| Safari / Chrome | Playwright WebKit/Chromium do not certify shipping Safari/iOS or branded Chrome. Missing engines remain untested. |

## Routes

| Input → Output | chromium | firefox | webkit |
|---|---|---|---|
| PNG → PNG | passed | untested | untested |
| PNG → JPEG | passed | untested | untested |
| PNG → WEBP | passed | untested | untested |
| PNG → BMP | passed | untested | untested |
| PNG → ICO | passed | untested | untested |
| PNG → TIFF | passed | untested | untested |
| JPEG → PNG | passed | untested | untested |
| JPEG → JPEG | passed | untested | untested |
| JPEG → WEBP | passed | untested | untested |
| JPEG → BMP | passed | untested | untested |
| JPEG → ICO | passed | untested | untested |
| JPEG → TIFF | passed | untested | untested |
| WEBP → PNG | passed | untested | untested |
| WEBP → JPEG | passed | untested | untested |
| WEBP → WEBP | passed | untested | untested |
| WEBP → BMP | passed | untested | untested |
| WEBP → ICO | passed | untested | untested |
| WEBP → TIFF | passed | untested | untested |
| AVIF → PNG | passed | untested | untested |
| AVIF → JPEG | passed | untested | untested |
| AVIF → WEBP | passed | untested | untested |
| AVIF → BMP | passed | untested | untested |
| AVIF → ICO | passed | untested | untested |
| AVIF → TIFF | passed | untested | untested |
| BMP → PNG | passed | untested | untested |
| BMP → JPEG | passed | untested | untested |
| BMP → WEBP | passed | untested | untested |
| BMP → BMP | passed | untested | untested |
| BMP → ICO | passed | untested | untested |
| BMP → TIFF | passed | untested | untested |
| ICO → PNG | passed | untested | untested |
| ICO → JPEG | passed | untested | untested |
| ICO → WEBP | passed | untested | untested |
| ICO → BMP | passed | untested | untested |
| ICO → ICO | passed | untested | untested |
| ICO → TIFF | passed | untested | untested |
| SVG → PNG | passed | untested | untested |
| SVG → JPEG | passed | untested | untested |
| SVG → WEBP | passed | untested | untested |
| SVG → BMP | passed | untested | untested |
| SVG → ICO | passed | untested | untested |
| SVG → TIFF | passed | untested | untested |
| GIF → PNG | passed | untested | untested |
| GIF → JPEG | passed | untested | untested |
| GIF → WEBP | passed | untested | untested |
| GIF → BMP | passed | untested | untested |
| GIF → ICO | passed | untested | untested |
| GIF → TIFF | passed | untested | untested |
| TIFF → PNG | passed | untested | untested |
| TIFF → JPEG | passed | untested | untested |
| TIFF → WEBP | passed | untested | untested |
| TIFF → BMP | passed | untested | untested |
| TIFF → ICO | passed | untested | untested |
| TIFF → TIFF | passed | untested | untested |
| WAV → WAV | passed | untested | untested |
| WAV → AIFF | passed | untested | untested |
| WAV → MP3 | passed | untested | untested |
| WAV → FLAC | passed | untested | untested |
| WAV → OGG | passed | untested | untested |
| WAV → OPUS | passed | untested | untested |
| WAV → AAC | passed | untested | untested |
| WAV → M4A | passed | untested | untested |
| AIFF → WAV | passed | untested | untested |
| AIFF → AIFF | passed | untested | untested |
| AIFF → MP3 | passed | untested | untested |
| AIFF → FLAC | passed | untested | untested |
| AIFF → OGG | passed | untested | untested |
| AIFF → OPUS | passed | untested | untested |
| AIFF → AAC | passed | untested | untested |
| AIFF → M4A | passed | untested | untested |
| MP3 → WAV | passed | untested | untested |
| MP3 → AIFF | passed | untested | untested |
| MP3 → MP3 | passed | untested | untested |
| MP3 → FLAC | passed | untested | untested |
| MP3 → OGG | passed | untested | untested |
| MP3 → OPUS | passed | untested | untested |
| MP3 → AAC | passed | untested | untested |
| MP3 → M4A | passed | untested | untested |
| FLAC → WAV | passed | untested | untested |
| FLAC → AIFF | passed | untested | untested |
| FLAC → MP3 | passed | untested | untested |
| FLAC → FLAC | passed | untested | untested |
| FLAC → OGG | passed | untested | untested |
| FLAC → OPUS | passed | untested | untested |
| FLAC → AAC | passed | untested | untested |
| FLAC → M4A | passed | untested | untested |
| OGG → WAV | passed | untested | untested |
| OGG → AIFF | passed | untested | untested |
| OGG → MP3 | passed | untested | untested |
| OGG → FLAC | passed | untested | untested |
| OGG → OGG | passed | untested | untested |
| OGG → OPUS | passed | untested | untested |
| OGG → AAC | passed | untested | untested |
| OGG → M4A | passed | untested | untested |
| OPUS → WAV | passed | untested | untested |
| OPUS → AIFF | passed | untested | untested |
| OPUS → MP3 | passed | untested | untested |
| OPUS → FLAC | passed | untested | untested |
| OPUS → OGG | passed | untested | untested |
| OPUS → OPUS | passed | untested | untested |
| OPUS → AAC | passed | untested | untested |
| OPUS → M4A | passed | untested | untested |
| AAC → WAV | passed | untested | untested |
| AAC → AIFF | passed | untested | untested |
| AAC → MP3 | passed | untested | untested |
| AAC → FLAC | passed | untested | untested |
| AAC → OGG | passed | untested | untested |
| AAC → OPUS | passed | untested | untested |
| AAC → AAC | passed | untested | untested |
| AAC → M4A | passed | untested | untested |
| M4A → WAV | passed | untested | untested |
| M4A → AIFF | passed | untested | untested |
| M4A → MP3 | passed | untested | untested |
| M4A → FLAC | passed | untested | untested |
| M4A → OGG | passed | untested | untested |
| M4A → OPUS | passed | untested | untested |
| M4A → AAC | passed | untested | untested |
| M4A → M4A | passed | untested | untested |
| ZIP → ZIP | passed | untested | untested |
| ZIP → TAR | passed | untested | untested |
| ZIP → TAR.GZ | passed | untested | untested |
| ZIP → GZIP | passed | untested | untested |
| TAR → ZIP | passed | untested | untested |
| TAR → TAR | passed | untested | untested |
| TAR → TAR.GZ | passed | untested | untested |
| TAR → GZIP | passed | untested | untested |
| TAR.GZ → ZIP | passed | untested | untested |
| TAR.GZ → TAR | passed | untested | untested |
| TAR.GZ → TAR.GZ | passed | untested | untested |
| TAR.GZ → GZIP | passed | untested | untested |
| GZIP → ZIP | passed | untested | untested |
| GZIP → TAR | passed | untested | untested |
| GZIP → TAR.GZ | passed | untested | untested |
| GZIP → GZIP | passed | untested | untested |
