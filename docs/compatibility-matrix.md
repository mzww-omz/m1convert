# Phase 8.1 — measured compatibility matrix

Generated from the same 134 fixture routes. WebKit is not shipping Safari; Chromium is not branded Chrome.
passed = downloaded and validated; unsupported = inspect succeeded but output was not advertised; failed = inspection/conversion/assertion failed; untested = browser/setup unavailable.
Success rate = passed / (passed + failed); coverage = attempted / 134. API presence does not guarantee codec or storage operation.

| Browser | Version | Passed | Unsupported | Failed | Untested | Success rate | Coverage | Conversion ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| chromium | 156.0.8078.4 | 134 | 0 | 0 | 0 | 100.0% | 100.0% | 96283 |
| firefox | 156.0 | 118 | 16 | 0 | 0 | 100.0% | 88.1% | 99329 |
| webkit | 26.6 | 125 | 9 | 0 | 0 | 100.0% | 93.3% | 107379 |

## Worker capabilities (presence, not operational guarantees)

| Capability | chromium | firefox | webkit |
|---|---|---|---|
| OffscreenCanvas | present | present | present |
| ImageBitmap | present | present | present |
| WebAssembly | present | present | present |
| AudioEncoder | present | present | present |
| AudioDecoder | present | present | present |
| OPFS API | present | present | present |
| Web Locks API | present | present | present |

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
| PNG → PNG | passed | passed | passed |
| PNG → JPEG | passed | passed | passed |
| PNG → WEBP | passed | passed | unsupported |
| PNG → BMP | passed | passed | passed |
| PNG → ICO | passed | passed | passed |
| PNG → TIFF | passed | passed | passed |
| JPEG → PNG | passed | passed | passed |
| JPEG → JPEG | passed | passed | passed |
| JPEG → WEBP | passed | passed | unsupported |
| JPEG → BMP | passed | passed | passed |
| JPEG → ICO | passed | passed | passed |
| JPEG → TIFF | passed | passed | passed |
| WEBP → PNG | passed | passed | passed |
| WEBP → JPEG | passed | passed | passed |
| WEBP → WEBP | passed | passed | unsupported |
| WEBP → BMP | passed | passed | passed |
| WEBP → ICO | passed | passed | passed |
| WEBP → TIFF | passed | passed | passed |
| AVIF → PNG | passed | passed | passed |
| AVIF → JPEG | passed | passed | passed |
| AVIF → WEBP | passed | passed | unsupported |
| AVIF → BMP | passed | passed | passed |
| AVIF → ICO | passed | passed | passed |
| AVIF → TIFF | passed | passed | passed |
| BMP → PNG | passed | passed | passed |
| BMP → JPEG | passed | passed | passed |
| BMP → WEBP | passed | passed | unsupported |
| BMP → BMP | passed | passed | passed |
| BMP → ICO | passed | passed | passed |
| BMP → TIFF | passed | passed | passed |
| ICO → PNG | passed | passed | passed |
| ICO → JPEG | passed | passed | passed |
| ICO → WEBP | passed | passed | unsupported |
| ICO → BMP | passed | passed | passed |
| ICO → ICO | passed | passed | passed |
| ICO → TIFF | passed | passed | passed |
| SVG → PNG | passed | passed | passed |
| SVG → JPEG | passed | passed | passed |
| SVG → WEBP | passed | passed | unsupported |
| SVG → BMP | passed | passed | passed |
| SVG → ICO | passed | passed | passed |
| SVG → TIFF | passed | passed | passed |
| GIF → PNG | passed | passed | passed |
| GIF → JPEG | passed | passed | passed |
| GIF → WEBP | passed | passed | unsupported |
| GIF → BMP | passed | passed | passed |
| GIF → ICO | passed | passed | passed |
| GIF → TIFF | passed | passed | passed |
| TIFF → PNG | passed | passed | passed |
| TIFF → JPEG | passed | passed | passed |
| TIFF → WEBP | passed | passed | unsupported |
| TIFF → BMP | passed | passed | passed |
| TIFF → ICO | passed | passed | passed |
| TIFF → TIFF | passed | passed | passed |
| WAV → WAV | passed | passed | passed |
| WAV → AIFF | passed | passed | passed |
| WAV → MP3 | passed | passed | passed |
| WAV → FLAC | passed | passed | passed |
| WAV → OGG | passed | passed | passed |
| WAV → OPUS | passed | passed | passed |
| WAV → AAC | passed | unsupported | passed |
| WAV → M4A | passed | unsupported | passed |
| AIFF → WAV | passed | passed | passed |
| AIFF → AIFF | passed | passed | passed |
| AIFF → MP3 | passed | passed | passed |
| AIFF → FLAC | passed | passed | passed |
| AIFF → OGG | passed | passed | passed |
| AIFF → OPUS | passed | passed | passed |
| AIFF → AAC | passed | unsupported | passed |
| AIFF → M4A | passed | unsupported | passed |
| MP3 → WAV | passed | passed | passed |
| MP3 → AIFF | passed | passed | passed |
| MP3 → MP3 | passed | passed | passed |
| MP3 → FLAC | passed | passed | passed |
| MP3 → OGG | passed | passed | passed |
| MP3 → OPUS | passed | passed | passed |
| MP3 → AAC | passed | unsupported | passed |
| MP3 → M4A | passed | unsupported | passed |
| FLAC → WAV | passed | passed | passed |
| FLAC → AIFF | passed | passed | passed |
| FLAC → MP3 | passed | passed | passed |
| FLAC → FLAC | passed | passed | passed |
| FLAC → OGG | passed | passed | passed |
| FLAC → OPUS | passed | passed | passed |
| FLAC → AAC | passed | unsupported | passed |
| FLAC → M4A | passed | unsupported | passed |
| OGG → WAV | passed | passed | passed |
| OGG → AIFF | passed | passed | passed |
| OGG → MP3 | passed | passed | passed |
| OGG → FLAC | passed | passed | passed |
| OGG → OGG | passed | passed | passed |
| OGG → OPUS | passed | passed | passed |
| OGG → AAC | passed | unsupported | passed |
| OGG → M4A | passed | unsupported | passed |
| OPUS → WAV | passed | passed | passed |
| OPUS → AIFF | passed | passed | passed |
| OPUS → MP3 | passed | passed | passed |
| OPUS → FLAC | passed | passed | passed |
| OPUS → OGG | passed | passed | passed |
| OPUS → OPUS | passed | passed | passed |
| OPUS → AAC | passed | unsupported | passed |
| OPUS → M4A | passed | unsupported | passed |
| AAC → WAV | passed | passed | passed |
| AAC → AIFF | passed | passed | passed |
| AAC → MP3 | passed | passed | passed |
| AAC → FLAC | passed | passed | passed |
| AAC → OGG | passed | passed | passed |
| AAC → OPUS | passed | passed | passed |
| AAC → AAC | passed | unsupported | passed |
| AAC → M4A | passed | unsupported | passed |
| M4A → WAV | passed | passed | passed |
| M4A → AIFF | passed | passed | passed |
| M4A → MP3 | passed | passed | passed |
| M4A → FLAC | passed | passed | passed |
| M4A → OGG | passed | passed | passed |
| M4A → OPUS | passed | passed | passed |
| M4A → AAC | passed | unsupported | passed |
| M4A → M4A | passed | unsupported | passed |
| ZIP → ZIP | passed | passed | passed |
| ZIP → TAR | passed | passed | passed |
| ZIP → TAR.GZ | passed | passed | passed |
| ZIP → GZIP | passed | passed | passed |
| TAR → ZIP | passed | passed | passed |
| TAR → TAR | passed | passed | passed |
| TAR → TAR.GZ | passed | passed | passed |
| TAR → GZIP | passed | passed | passed |
| TAR.GZ → ZIP | passed | passed | passed |
| TAR.GZ → TAR | passed | passed | passed |
| TAR.GZ → TAR.GZ | passed | passed | passed |
| TAR.GZ → GZIP | passed | passed | passed |
| GZIP → ZIP | passed | passed | passed |
| GZIP → TAR | passed | passed | passed |
| GZIP → TAR.GZ | passed | passed | passed |
| GZIP → GZIP | passed | passed | passed |
