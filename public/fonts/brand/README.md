# Vapi brand fonts (licensed, not committed)

This directory holds the licensed Vapi brand typefaces used in production:

- **Avantt** (`Avantt-*.woff2`) — display / headings
- **Season Sans** (`SeasonSans-*.woff2`) — body
- **Foundry Gridnik** (`FoundryGridnik-Medium.otf`) — eyebrow / uppercase labels

These are **commercial, licensed fonts**, so the binaries are **gitignored**
(`public/fonts/brand/*.woff2`, `*.otf`) and never committed to this open-source
repo. Only this README is tracked.

## How it works

- `@font-face` declarations live in `src/styles/brand-fonts.css` and point at
  `/fonts/brand/*`. They use `font-display: swap`.
- The type tokens (`src/styles/tokens.css`, `src/styles/shell.css`) list each
  brand face **first**, then a bundled open fallback loaded via `next/font`
  (Instrument Sans for display/body, Tomorrow for eyebrows), then system fonts.
- If the binaries are absent (forks, clones, or any checkout without them), the
  URLs simply 404 and the page renders in the open fallbacks. The build never
  depends on these files being present (the absolute `/fonts/brand/*` URLs are
  not resolved at build time).

## Production

Production is deployed with the Vercel CLI (`vercel --prod`), which uploads the
local working directory. `.vercelignore` does **not** exclude this directory, so
the licensed fonts reach production even though git ignores them. A bare
`git push` (Git auto-deploy) builds without these files and will fall back to
the open fonts; deploy via `vercel --prod` to ship the brand fonts.
