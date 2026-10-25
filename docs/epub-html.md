# EPUB → HTML (standalone, offline)

Convert now offers **EPUB → HTML** in addition to Phase 11's **EPUB → TXT**. HTML is one UTF-8 HTML document; the browser can open it directly without an asset folder, CDN, server, or network request.

## What is retained

- XHTML spine chapters in reading order, with headings, paragraphs, inline semantics, lists, images, figures, tables, ruby markup, and internal chapter/fragment links.
- Manifest-declared PNG, JPEG, GIF, WebP and AVIF images and basic WOFF, WOFF2, TTF and OTF fonts, embedded as local Base64 data URLs when their signatures match their MIME declarations.
- Manifest-declared CSS stylesheets and embedded/inline CSS, with references to supported local images/fonts rewritten. Simple local CSS imports are resolved (at most 8 levels); external references/imports are suppressed.
- OPF title and language metadata when available.
- Image-only XHTML chapters. If the book has no extractable text, TXT is not offered, while HTML remains available.

The HTML is **reflowable**. Combining chapters into one HTML page is not a faithful reproduction of every EPUB reader's separate-document cascade, pagination or fixed-layout rendering. CSS rules from different chapters may interact; external fonts/resources not included in the EPUB are not fetched. EPUB media overlays, interactive scripts, forms, SVG/MathML, nested frames, unsupported image/font formats, EPUB2 DTDs, DRM and encrypted resources are not supported.

## Security, resource limits and verification

- All work remains in the existing cancellable local worker. EPUB ZIP, container, package and spine checks run before conversion.
- Strict bounded XHTML tokenization, escaping and an explicit safe HTML element/attribute allowlist. Scripts, event handlers, embeds, forms and external links/resources are removed. The result contains a CSP that permits only inline styles and embedded images/fonts.
- CSS references are rewritten only for validated local resources, otherwise replaced with an inert data URL. Stylesheet imports are local-only or omitted.
- ZIP compressed input and decompressed entries: 64 MiB each; up to 1000 entries. Each XHTML chapter: 8 MiB of text. Each CSS resource: 4 MiB. Standalone HTML: 96 MiB UTF-8 output. Existing TXT extraction retains the 16 MiB text limit.
- Tested in Chromium: EPUB → HTML download, opening generated file content, decoded embedded PNG, actual computed CSS color and no external requests. Unit tests exercise ordering, links, title/language metadata, local CSS imports, image-only books, malicious markup and external CSS.

Run:

- npm test — unit regressions
- npm run check — TypeScript and Svelte checks
- npm run build — static output build
- Start npm run dev -- --host 127.0.0.1, then run npm run test:phase11 — browser conversions

See the [W3C EPUB 3.3 specification](https://www.w3.org/TR/epub-33/) for EPUB's full presentation and reading-order model. Convert implements a bounded, intentionally static subset, **not** a complete EPUB reading system.
