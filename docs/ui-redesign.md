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
