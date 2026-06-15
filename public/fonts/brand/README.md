# Vapi brand fonts (licensed, not committed)

This directory holds the licensed Vapi brand typefaces used in production:

- **Avantt** (`Avantt-*.woff2`) — display / headings
- **Season Sans** (`SeasonSans-*.woff2`) — body
- **Foundry Gridnik** (`FoundryGridnik-Medium.otf`) — eyebrow / uppercase labels

These are **commercial, licensed fonts**, so the binaries are **gitignored**
(`public/fonts/brand/*.woff2`, `*.otf`) and never committed to this open-source
repo. Only this README is tracked.

## How it works

- The fonts are hosted on the project's **Vercel Blob** store under
  `fonts/brand/*` and loaded from absolute Blob URLs in
  `src/styles/brand-fonts.css` (`font-display: swap`). The Blob origin serves
  them with permissive CORS (`Access-Control-Allow-Origin: *`), so the
  cross-origin `@font-face` loads cleanly.
- Because the CSS points at the stable Blob URLs (not local files), **every
  deploy renders the brand fonts the same way** — a bare `git push` (Git
  auto-deploy) and `vercel --prod` (CLI) both resolve the same URLs, and the
  local binaries here are not needed at build time. `.vercelignore` excludes
  this directory, so the licensed files never ship with the build.
- The type tokens (`src/styles/tokens.css`, `src/styles/shell.css`) list each
  brand face **first**, then a bundled open fallback loaded via `next/font`
  (Instrument Sans for display/body, Tomorrow for eyebrows), then system fonts —
  so forks/clones (and any environment that can't reach Blob) still render.

## Refreshing the fonts

Drop the updated binaries in this directory and re-upload them to Blob:

```
bun scripts/upload-brand-fonts.ts
```

The script reads `BLOB_READ_WRITE_TOKEN` (from the environment or
`src/pipeline/.env`) and uploads each file to `fonts/brand/<name>` on a stable
path (no random suffix), so the URLs in `brand-fonts.css` stay valid.
