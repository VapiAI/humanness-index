# The Humanness Index™: standalone open-source extraction spec

Status: EXECUTED through phase 3 (extraction, infra, production deploy and
verification all complete; site live). Remaining: phase 4 public flip
(gated on Turnstile keys + history squash) and the DNS/Git-integration
items listed at the end. As of 2026-06-12.

This repo will become the standalone, open-source home of The Humanness
Index, currently shipping inside the private `VapiAI/landing-v2` site as
`src/modules/HumannessIndex` (PR stack #415 to #418). This spec defines how
we extract it, what must never leave the private repo, how the new domain
takes over from `vapi.ai/humanness-index`, and what "open source" means for
a benchmark whose credibility depends on it.

## 1. Goals

- One public repo containing the full benchmark: page, detail pages, vote
  backend, Elo engine, model registry, and the clip/benchmark pipeline.
  Anyone can read exactly how scores are produced.
- Hosted at `humannessindex.vapi.ai` with `vapi.ai/humanness-index`
  301-ing to it.
- Community participation without compromising methodology: model
  suggestions and code contributions are open; clip generation and
  registration stay maintainer-gated because they require our licensed
  cloned voices.
- Vapi attribution without Vapi coupling: the site stands alone, built and
  operated by Vapi, linking back to vapi.ai.

## 2. Non-goals

- Open-sourcing the audio: the source voice masters are licensed talent
  recordings and the 1,700+ generated clips derive from them. They are
  served from our storage under terms, never committed.
- Decentralized vote infrastructure. The store stays ours; the code that
  runs it is public.
- A redesign. The extracted site keeps today's design language minus the
  Vapi site chrome.

## 3. What moves, what is replaced, what is scrubbed

### 3.1 Moves nearly verbatim (from the landing-v2 module)

- `catalog/` registry (single source of truth), `server/` arena (Elo,
  pairing, HMAC battle tokens, Blob event store, rate limiting, Turnstile),
  `lib/`, `hooks/`, `data/` derivations, `components/` including
  `components/detail/`, `styles/` (scoping can relax once standalone, see
  3.4), the four API routes, the detail-page routes and OG generation, the
  98-test suite, and `pipeline/` (transports, clip generation, upload,
  verify, 50-trial TTFB bench, RUNBOOK).
- `public/humanness-index/` assets: provider logomarks (nominative use of
  third-party marks; keep an attribution note in the README), OG image,
  textures.

### 3.2 Replaced for standalone operation

- App shell: landing-v2's `AirfoilLayout`, navbar, footer, and cookie
  tooling do not move. New minimal `app/layout.tsx` with its own nav
  (logo, GitHub link, "built by Vapi") and footer (methodology, terms,
  contact, vapi.ai).
- Routes flatten: `/humanness-index` becomes `/`; detail pages become
  `/models/[slug]` and `/providers/[slug]`. Slug VALUES are frozen; only
  the prefix changes. `lib/detail.ts` already centralizes path building,
  so this is a constants change.
- Typography: the module inherits Vapi's licensed Avantt via
  `--font-avantt`. The standalone site substitutes an open font with
  similar weight and metrics (candidate: Instrument Sans or Space Grotesk via
  next/font) behind the existing `--font-display` token. One-line swap in
  `tokens.css`, visual QA pass required.
- Analytics: PostHog stays (own project key, env-gated, capture disabled
  without the key, which also keeps forks clean). `lib/analytics.ts`
  already null-safe; the posthog-cta CTA-page coupling is dropped in favor
  of plain event names.
- CTA band: marketing CTAs become "Run your model" (contact) and "Star on
  GitHub".

### 3.3 Scrubbed before the repo flips public (hard gate)

- Secrets: nothing from `pipeline/.env` or any env file. `.env.example`
  only. Audit: `git log -p | rg` for key prefixes (`sk-`, `xai-`, token
  shapes) across full history before the public flip; history must be
  born clean (see section 5).
- Licensed audio: no `pipeline/results/`, no source masters, no clips.
  `.gitignore` carries these from day one.
- Private-infra references: internal repo paths in comments (provider
  protocol notes rewritten against the vendors' public docs), credential
  provenance notes in the RUNBOOK, internal project ids, references to the
  pre-launch prototype, and internal service endpoints.
- Embargoed registry entries: any unlisted entry for a model without a
  public launch is stripped from the public registry and kept in the
  gitignored overlay until its vendor announces (see 4.3).

### 3.4 Permitted relaxations (post-extraction cleanups, not blockers)

- The `.hi-page` CSS scoping existed to avoid bleeding into the marketing
  site; standalone it can stay (harmless) or be flattened gradually.
- `LeaderboardSection`'s "Most Human Models" and the deep-dive sections can
  merge into a single-page flow if we later want; out of scope for v1.

## 4. Repository design

### 4.1 Layout

```
humanness-index/
  app/                    # Next.js App Router: /, /models/[slug],
                          # /providers/[slug], /api/{models,battle,vote,sample}
  src/
    catalog/              # registry (source of truth)
    server/               # arena, elo, store, tokens, rateLimit, turnstile
    lib/  hooks/  components/  data/  styles/
    pipeline/             # clip + bench tooling (maintainer-run)
  public/marks/  public/og/
  docs/
    METHODOLOGY.md        # blind same-voice battles, Elo, measured-only
                          # latency, inclusion criteria (cloning required)
    ADDING_A_MODEL.md     # the registry checklist, public version
  SPEC.md                 # this file
  README.md  LICENSE  TRADEMARKS.md  CONTRIBUTING.md  SECURITY.md
```

### 4.2 Stack

Next.js 16 (same version as landing-v2 to avoid behavior drift at
extraction), Bun for scripts/tests, Vercel hosting, Vercel Blob for the
event store and audio origin. CI: GitHub Actions running check-types, the
full test suite, and a production build on every PR; preview deploys via
the Vercel GitHub integration.

### 4.3 Registry and the private overlay

The public registry holds every LISTED model. Unannounced or embargoed
entries live in a tiny gitignored overlay (`catalog/overlay.local.ts`,
type-constrained to unlisted status) merged at load, keeping the public
repo truthful without leaking partner timelines. If the overlay is absent
the mechanism is dormant. This is the only private code path and it is
documented as such.

## 5. History and provenance

Born-clean history: the first commit is the extracted tree (squashed from
the landing-v2 stack tip), not a filtered landing-v2 history. Rationale:
landing-v2 history contains unrelated private work and any filter mistake
is unrecoverable once public. The landing-v2 PR stack remains the private
provenance record.

## 6. Licensing and trademark

- Code: Apache-2.0 (patent grant matters; several TTS vendors are
  litigious neighborhoods).
- Content split, stated in README and TRADEMARKS.md:
  - Code and docs: Apache-2.0.
  - "The Humanness Index™" name and logo: Vapi trademark, not licensed by
    the code license. Forks must rename (standard TRADEMARKS.md language).
  - Audio clips and source voices: proprietary, all rights reserved,
    served from our origin for the benchmark UI only. Not redistributable.
  - Vote data and standings: published under CC BY 4.0 with attribution
    (the leaderboard JSON is already public via the API; make it official).
- Provider logomarks remain property of their owners, used nominatively.

## 7. Infrastructure and environments

New Vercel project `humanness-index` on this repo.

| Concern | Plan |
| --- | --- |
| Domain | `humannessindex.vapi.ai` (confirmed): a CNAME in the existing vapi.ai zone pointing at the new Vercel project; no apex purchase. Staying under vapi.ai keeps the brand family and passes site reputation to the subdomain |
| Blob store | NEW store for the public project. One-time copy of the 1,700+ clips from the landing store (pipeline `uploadClips` already skip-if-exists; point it at the new token and re-upload from hashes manifest). `HUMANNESS_AUDIO_ORIGIN` points at the new store |
| Vote store | NEW event store seeded from the production export at cutover (same seeding path the module already uses). Votes accrued on vapi.ai up to cutover are preserved in the seed |
| Env vars | `HUMANNESS_BATTLE_TOKEN_SECRET` (new secret), `BLOB_READ_WRITE_TOKEN` (new store), `HUMANNESS_AUDIO_ORIGIN`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` (new site registration, REQUIRED in production since the repo is public and the vote endpoint is documented), optional PostHog key |
| Abuse posture | Public repo means the vote API shape is public. Keep: HMAC battle tokens (single-use), per-IP rate limiting, Turnstile every Nth vote. Move N and the rate caps to env so production tuning is not visible in code |

## 8. SEO cutover from vapi.ai

The detail pages just shipped on vapi.ai paths; we migrate deliberately to
avoid a duplicate-content interregnum.

1. Launch the new domain fully (all 24+ pages live, sitemap, JSON-LD).
2. Flip `vapi.ai/humanness-index*` to 301s (next.config redirects in
   landing-v2), path-for-path: `/humanness-index/models/X` to
   `https://<domain>/models/X`. Slugs are frozen so the map is mechanical.
3. Remove the module from landing-v2 in a follow-up PR (the stack's
   reviewers already know the seams); keep the navbar Resources link,
   now external.
4. Search Console: add the new property, submit the sitemap, monitor the
   301 pickup. Canonicals on the new site self-reference from day one.
5. The `humanness-index@vapi.ai` contact stays (email, domain-independent).

## 9. Community model

- Issues: model requests (template asks: provider, model id, cloning
  support with source, public API availability) and bug reports.
- PRs welcome on: app code, registry COPY corrections with sources, docs,
  pipeline tooling. PRs cannot add models end-to-end (clip generation
  requires our licensed voices and keys); maintainers run the pipeline per
  ADDING_A_MODEL.md. This constraint and its fairness rationale (same
  cloned voice on both sides of every battle) are documented prominently.
- The TTS landscape research (cloning support across ~50 models) can be
  resurrected from the landing-v2 backup ref as a public docs page later;
  optional.

## 10. Execution phases

| Phase | Work | Gate |
| --- | --- | --- |
| 0 | This spec reviewed; domain + license + analytics decisions confirmed | User sign-off |
| 1 | Scaffold: Next app shell, fonts, layout, CI, repo hygiene files | Build green in CI |
| 2 | Extraction: move the module per section 3, flatten routes, scrub per 3.3 (checklist PR with every scrub item ticked) | 98 tests green, build green, scrub checklist reviewed |
| 3 | Infra: new Blob store + clip copy, new vote store seeded, Vercel project, domain, env, Turnstile | Staging URL passes the full browser pass (battle, vote, reveal, sorting, detail pages, mobile) |
| 4 | Public flip + launch: history audit (5), license files in place, repo public, domain live | Secrets audit clean |
| 5 | Cutover: vapi.ai 301s, landing-v2 module removal, Search Console | 301s verified, no 404s in the old sitemap |

Phases 1 to 3 happen while this repo is private. Nothing in landing-v2
changes until phase 5, so the PR stack (#415 to #418) merges independently
of this work.

## 11. Open questions

1. ~~Domain name~~ Resolved: `humannessindex.vapi.ai`.
2. License confirmation: Apache-2.0 proposed over MIT for the patent grant.
3. Analytics: keep PostHog (own key) or none at launch?
4. Does viz-lab ship publicly (it is a useful design-transparency artifact)
   or stay private?
5. Cutover timing relative to the landing-v2 stack: recommend letting the
   stack merge and bake on vapi.ai first, then extract from main rather
   than from the stack branches.
6. Who are the initial maintainers / CODEOWNERS?
