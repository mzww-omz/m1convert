# File-format icons

These 16 SVGs are official [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) assets, used unchanged. Copyright (c) 2025 Material Extensions; [MIT license](LICENSE).

- Source revision: [`1a9d4b3d478d7fd1c49a86ea371ec6a8b505b097`](https://github.com/material-extensions/vscode-material-icon-theme/tree/1a9d4b3d478d7fd1c49a86ea371ec6a8b505b097/icons) (5.39.0).
- All SVGs except `file.svg` come directly from that revision's `icons/` directory.
- The upstream generator produces `file.svg`, so it is copied unchanged from the official [`material-icon-theme@5.39.0` npm distribution](https://unpkg.com/material-icon-theme@5.39.0/icons/file.svg).
- Extension groups follow upstream `src/core/icons/fileIcons.ts`, plus Convert's `jpe` alias. Ogg defaults to audio here; verified audio/archive categories and recognized MIME types take precedence over misleading names. Remaining compound names use their final suffix (`tar.gz`, `tar.bz2`, etc.).
- Unknown types use `file.svg` beside the existing full filename, including its extension. When no recognized MIME/category is available, the extension selects the icon. These associations are visual only, not conversion or validation support.

Assets are served locally, with no runtime CDN requests. The existing 16px decorative image elements and their alignment/opacity are retained. No operation icons use these assets.
