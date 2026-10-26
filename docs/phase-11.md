# Phase 11 — EPUB text, Netpbm images and Unix ar

**Follow-up:** EPUB → HTML is now implemented as a separate static, standalone output. See [EPUB HTML: fidelity, security and QA](epub-html.md). The original TXT-only boundaries below describe Phase 11's first release.

Branch: `feat/phase11-ebook-pnm-ar`. Phase 10 commits are its base; this phase does not automatically push or deploy.

## EPUB (input → plain text)

- Recognizes EPUB by the mandatory uncompressed first ZIP member named `mimetype` with exactly `application/epub+zip`. Ordinary ZIPs remain ZIPs.
- Reuses the project's bounded ZIP entry parser and checks `META-INF/container.xml`, the OPF manifest and the linear reading-order spine. Missing resources, unsafe paths, duplicate XML attributes, malformed chapter references and extra tracks fail explicitly.
- Supports XHTML spine documents in EPUB 3-compatible UTF-8 without DTD/external entity parsing. Handles basic text entities, paragraphs and headings.
- Outputs actual UTF-8 `.txt` with chapter-order whitespace.
- **This is text extraction, not a layout-preserving eBook conversion.** Images, CSS, fonts, tables, footnotes, sidebars and relative resource layout are not maintained. EPUB2 books with DOCTYPE/entity expansion and unusual EPUB3 chapter structures may be rejected.
- Input ZIP is capped at 64 MiB, extracted content at the archive decoder's 64 MiB budget, individual XHTML/XML at 8 MiB and output text at 16 MiB. No network reads or remote fetches.
- No arbitrary HTML loading or execution in the browser. The worker interprets a limited XML subset as text.

Reference: [W3C EPUB 3.3 / OCF container requirements](https://www.w3.org/TR/epub-33/). This does not claim full EPUB spec conformance.

## Image: Netpbm P1–P6

| Format | Inputs | Output | Conversion |
| --- | --- | --- | --- |
| PBM | P1 ASCII, P4 bit-packed | P4 | 1-bit black/white; threshold at gray 128 |
| PGM | P2 ASCII, P5 binary | P5 | Opaque grayscale; 8-bit output |
| PPM | P3 ASCII, P6 binary | P6 | Opaque RGB; 8-bit output |

- 8-bit or 16-bit maximum component input values are scaled to RGBA8. No alpha channel in standard Netpbm outputs; source alpha composites onto white.
- Bounded by existing 64 MiB input/output and 256 MiB working memory limits; dimensions and exact raster lengths are checked before allocation.
- The same image adapter remains in charge of all input/output paths. Built-in encoders are re-read and verified like other formats.
- P7 PAM, floating-point PFM, 16-bit-preserving outputs, ICC/HDR and proprietary image formats are deferred.

## Archive: Unix ar

- Signature `!<arch>\n`; extensions `.ar`, `.a`, and compatible Debian `.deb` packages.
- Reads ordinary ar entries, GNU long-name tables and BSD extended filenames. Ignores indexing/symbol-table members.
- Converts archived *files* to ZIP, TAR and existing compatible TAR compression outputs. Safe path and duplicate collision validation are reused; max 1000 entries and 2 GiB archive streaming limit.
- A Debian `.deb` is an ar container. Converting it to ZIP preserves `debian-binary`, `control.tar.*` and `data.tar.*` as members; it does not recursively convert nested compressed TAR data or execute package scripts.
- Input only. No `.ar` writer in this phase. Split, malformed, overlapping or unsafe entries must not silently succeed.

## QA

- `npm run check`
- `npm test` (includes `tests/phase11-epub.test.mjs`, `tests/phase11-pnm.test.mjs`, `tests/phase11-ar.test.mjs`)
- `npm run build`
- Run `npm run dev -- --host 127.0.0.1` and `npm run test:phase11` in separate terminals.

The browser test covers EPUB → TXT, PPM → PNG, PNG → PPM/PGM/PBM, ar → ZIP, output bytes, original MorphSurface identity and lack of external network requests. Unit tests cover malicious EPUB references/DTD, unsupported outputs, corrupt PNM raster lengths and unsafe/truncated ar entries.

Browser verification is Chromium-based; Firefox, Safari, large real ebooks and real Debian packages require additional QA.

## Next scopes

- **High-fidelity eBook:** Standalone EPUB → HTML with validated embedded assets and sanitization is implemented as a follow-up; full EPUB-reader fidelity, exact fixed layout and calibre-equivalent MOBI/AZW3 support remain future work.
- **Office/Documents:** preserve layout using a real rendering engine; don't call plaintext extraction a PDF/Office conversion.
- **More formats:** QOI/TGA/ICNS, CAB/CPIO, and additional safe archive writers can be separate phases after tests.
