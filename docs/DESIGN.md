# Convert UI

The text-first Convert UI from `a05aa55` is the visual baseline. The subsequent macOS-style utility redesign has been withdrawn.

- Preserve the original header/footer, layout, spacing, settings, previews, text buttons and CSS.
- Keep MorphSurface's original sizes, 3px corners, width/height transitions, persistent DOM node, focus handoff and Reduced Motion behavior.
- The sole retained visual addition is a subdued 16px file-type icon next to input/output filenames. Local Material Symbols Sharp SVGs cover images, audio, video, archives and documents; they are decorative to assistive technology.
- A video/document icon does not imply conversion support. Actual destinations and validation still come from the existing engine and registry. Verified MIME/category takes precedence over the input MIME type.
- Do not reintroduce icon-only actions, a header logo, compact toolbar, collapsed settings or redesigned batch lists.
- Preserve the conversion engines, all routes, error handling, cancellation, batch conversion and resource release.

`npm run test:utility` checks restored text controls, Surface sizes/identity, icons, desktop/mobile states, keyboard, batch downloads and recovery. `BROWSER=firefox` or `BROWSER=webkit` selects an existing installed patched browser. Historical redesign/rollback evidence is in [ui-redesign.md](ui-redesign.md).
