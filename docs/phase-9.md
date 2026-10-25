# Phase 9 - additional codecs and formats (2026-10-24)

Phase 9 expands **local browser-only** conversion without changing MorphSurface, adding any network conversion service, or relaxing existing resource checks.

## Implemented

| New input | New output | Implementation | Chromium end-to-end evidence |
| --- | --- | --- | --- |
| JPEG XL (JXL) | JXL | `@jsquash/jxl@1.2.0`, lazy single-thread WASM | PNG -> JXL -> PNG, structural signature and 128x80 dimensions |
| HEIC / HEIF with HEVC still image | None | `libheif-js@1.23.5`, lazy WASM | Independent 128x80 x265-produced HEIC -> PNG and 3992x2992 camera HEIC -> PNG |
| 7z | None | `libarchive.js@2.0.2`, lazy self-hosted WASM | 7z -> ZIP, payload extracted and ZIP checked |
| RAR3 / RAR5 | None | Same libarchive WASM | Both RAR variants -> ZIP; independent CC0 fixtures |
| XZ (including TAR.XZ) | TAR.XZ | Same libarchive WASM | TAR.XZ -> ZIP; RAR3 -> TAR.XZ -> ZIP, signatures and payload checked |
| BZip2 (including TAR.BZ2) | TAR.BZ2 | Same libarchive WASM | TAR.BZ2 -> ZIP; RAR3 -> TAR.BZ2 -> ZIP, signatures and payload checked |
| Zstandard (including TAR.ZST) | None | `fzstd@0.1.1` streaming JS decompressor | TAR.ZST -> ZIP, payload checked |

Registered image outputs include PNG, JPEG, WEBP, JXL, BMP, ICO and TIFF, with AVIF output still conditional upon the browser's actual encoder. Archive outputs include ZIP, TAR, TAR.GZ, conditional single-file GZIP, and conditional **TAR.XZ / TAR.BZ2**. The latter use libarchive.js WASM, require one or more regular files without explicit directory records, enforce a 64 MiB expanded-input and encoded-output budget, and re-open the compressed TAR to compare every filename and payload. **7z, RAR and Zstandard outputs are not implemented**; their tested encoders were unsuitable. Standalone XZ/BZip2 output is not implemented.

The old **134 paths** (54 image, 64 audio, 16 archive) were independently verified in Phase 8.1. The expanded registry can expose additional image and archive routes, conditional on verified encoders, browser support and archive contents. It is **not a fully verified all-pairs matrix**: the new fixture E2E tests prove specific inputs and outputs, not every possible combination.

## Safety boundaries

- Original file contents, not name/MIME alone, determine the codec.
- Buffered images stay under 64 MiB encoded input/output and the existing 256 MiB image working-set estimate. JXL header width/height are checked before the WASM decode; decoded dimensions and JXL output are rechecked. HEIC/HEIF checks the reported dimensions and rejects multiple images.
- New libarchive inputs are limited to **64 MiB input**, **64 MiB summed expanded files**, **1000 entries** and strict existing safe path validation. No disk extraction. Only regular files and directories; links/devices and collision/traversal paths are rejected. Entry sizes are verified after extraction; extraction stays in a nested worker terminated on completion.
- New compressed TAR writing uses the libarchive WASM writer after full input validation, and verifies the output by re-reading. Explicit directory entries are rejected because this writer cannot faithfully preserve them; 7z and Zstandard output were trialed but are deliberately not advertised.
- The libarchive wrapper's `getFilesObject()` is deliberately unused, since it builds nested objects from untrusted paths. The flat `listFiles()` path is independently validated before extraction.
- Zstandard uses incremental `Decompress` callbacks with a **64 MiB expansion budget**, then the existing strict USTAR reader where applicable. Other standalone compressed bytes become a single file.
- New archive readers **do not support password-protected archives**; unavailable algorithms must fail. Empty/unsupported archives and non-file members do not silently become empty ZIPs.
- Due to libarchive.js exposing only the nanosecond component of mtime, the new WASM archive paths deliberately use a normalized timestamp rather than fabricate the original modification date. Contents/paths are retained, but not all metadata.
- Animation and multi-image HEIF remain unsupported; GIF/APNG/animated WebP remain rejected as previously.
- Real-world HEIC encoder patent/licensing obligations and LGPL-3.0 redistribution requirements must be reviewed before public deployment. No push or deployment is part of this phase.

## Reproducible verification

```sh
npm run check
npm test
npm run build
npm run test:phase9
```

`test:phase9` runs the Chromium JPEG XL round trip, HEIC-to-PNG, six independent archive variants to ZIP, RAR3 -> TAR.XZ and TAR.BZ2 -> ZIP round trips, checks that directory-containing archives cannot target these new outputs, a compressed Zstandard expansion bomb rejection, and absence of file uploads or external requests. For a real camera HEIC regression also run:

```sh
HEIC_FIXTURE=/path/to/camera-photo.heic node tests/phase9-heic-browser.mjs
```

The small HEIC fixture was produced from the repository's swatch.png with Ubuntu libheif 1.17.6 and x265, independently of the browser decoder. RAR3 and RAR5 fixtures come from [ssokolow/rar-test-files](https://github.com/ssokolow/rar-test-files), released CC0-1.0. Archive TAR/XZ/BZip2/Zstandard fixtures were generated from the repository's existing sample TAR; the 7z sample uses swatch.png.

## Licenses and dependencies

- `@jsquash/jxl@1.2.0` wrapper Apache-2.0, libjxl upstream BSD-3-Clause. `/legal/JXL-LICENSE`.
- `libheif-js@1.23.5` LGPL-3.0, including underlying libheif/libde265 build. `/legal/HEIF-LICENSE`. [libheif-js source](https://github.com/catdad-experiments/libheif-js); [libheif source](https://github.com/strukturag/libheif); [libde265 source](https://github.com/strukturag/libde265).
- `libarchive.js@2.0.2` wrapper MIT, native libarchive BSD. `/vendor/libarchive/LICENSE`; [source/build project](https://github.com/nika-begiashvili/libarchivejs).
- `fzstd@0.1.1` MIT. `/legal/ZSTD-LICENSE`; [source](https://github.com/101arrowz/fzstd).

All runtime scripts/WASM are served by the same site. There are no runtime CDN calls. The existing libav, PNG and Mediabunny source/license notices remain unchanged.
