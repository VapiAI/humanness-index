# The Humanness Index™: architecture & design spec

The Humanness Index is the open benchmark for how human voice AI sounds,
built and operated by [Vapi](https://vapi.ai) and live at
[humannessindex.vapi.ai](https://humannessindex.vapi.ai). Humanness is whether
a voice can pass as a real person in a live conversation, not a feature
checklist. Listeners hear two voices read the same line, both in one shared
source voice, blind, and pick whichever sounds more human; rankings derive
purely from those votes.

This document is the technical spec: how the system is put together and why.
For the scoring write-up see [docs/METHODOLOGY.md](docs/METHODOLOGY.md); for
the model-onboarding process see [docs/ADDING_A_MODEL.md](docs/ADDING_A_MODEL.md).

## 1. Goals

- One public repo containing the full benchmark: the site, the detail pages,
  the vote backend, the Elo engine, the model registry, and the
  clip/benchmark pipeline. Anyone can read exactly how scores are produced.
- Pure-vote scoring with a real-human reference point, no editorial weighting.
- Latency measured, never estimated: humanness can't come at the cost of
  conversational responsiveness, so time-to-first-audio is benchmarked in
  repo and plotted alongside humanness (the ideal model is human-level and
  instant).
- Community participation without compromising methodology: model suggestions
  and code contributions are open; clip generation and registration stay
  maintainer-gated because they require the licensed cloned voices.

## 2. Non-goals

- Open-sourcing the audio. The source-voice masters are licensed talent
  recordings, and the generated clips derive from them. They are served from
  our storage for the benchmark UI only, never committed (see TRADEMARKS.md).
- Decentralized vote infrastructure. The store is ours; the code that runs it
  is public and auditable.

## 3. Stack

- Next.js (App Router) + React, TypeScript throughout.
- Bun for scripts and the test suite.
- Vercel hosting; Vercel Blob for both the event-sourced vote store and the
  audio origin that serves `audio/{contentHash}.mp3`.
- Optional Upstash Redis (durable rate limiting) and Cloudflare Turnstile
  (every-Nth-vote challenge); optional PostHog analytics. The app is fully
  functional locally with none of them set.

## 4. Repository layout

```
app/                  Next.js App Router: /, /models/[slug],
                      /providers/[slug], /api/{models,battle,vote,sample}
src/catalog/          model + provider registry (single source of truth)
src/server/           arena service, Elo engine, vote store, battle tokens,
                      rate limiting, Turnstile
src/components/       page sections + detail-page islands
src/lib/ src/hooks/   client data layer, scoring, visualizers
src/data/             first-paint derivations of the registry + seed export
src/pipeline/         maintainer-run clip generation, human-clip ingest,
                      upload, verification, and the 50-trial TTFB bench
                      (see its RUNBOOK.md)
docs/                 methodology + the public add-a-model checklist
public/marks/         provider logomarks (nominative use); public/og/ images
```

## 5. Registry and the private overlay

`src/catalog/` is the single source of truth for model and provider identity,
stats, and copy. Every claimed fact carries a `sourceUrl` and an `asOf` date,
enforced by the test suite.

The public registry holds every LISTED model. Unannounced entries (a model
tested before its provider's public launch) live in a tiny gitignored overlay
(`catalog/overlay.local.ts`, type-constrained to unlisted status) that is
merged at load. If the overlay is absent the mechanism is dormant, and
`bun install` generates the empty default via `scripts/ensure-overlay.ts`.
This keeps the public repo truthful without leaking partner timelines, and it
is the only private code path.

Models carry a few status-shaping fields:

- `status: 'active' | 'retired' | 'unlisted'`. Retired models leave battle
  sampling and the table but keep their detail pages live (an earned URL never
  404s). Unlisted models are excluded from every public surface.
- `baseline: true` marks the Human reference (see section 7).
- `sourceVoices?` restricts a model to the source voices it actually has clips
  for. Omitted means all four; the arena only builds variants and battle
  pairings for the listed voices.

## 6. The arena: blind battles and pure-vote Elo

- A battle plays one shared source voice through two models reading the same
  prompt. Both clips address pre-generated `audio/{hash}.mp3` files by a frozen
  content hash (`sha256("variant:{voiceId}:{providerId}:{arenaApiId}|{promptId}|settings-v3")[:32]`).
- Each (voice, model) variant carries an Elo rating (initial 1200, K = 32). A
  model's displayed rating is the mean of its variants. The Humanness score
  normalizes the field's Elo so the anchor reads 100 and the lowest reads 0
  (see section 7 for the anchor).
- Pairing is convergence-weighted: under-voted models are forced into coverage
  first, then pairs are weighted toward information gain. The shared voice is
  drawn from the intersection of both models' available `sourceVoices`.
- The store is event-sourced: standings are a deterministic fold of vote
  events over the production seed (`src/server/seed-standings.json`), so the
  math in `src/server/elo.ts` and `src/server/store.ts` is fully auditable.

### 6.1 Blind-test integrity

The battle is blind by construction, enforced server-side:

- `createBattle` (and `GET /api/battle`) returns NO model identities, only the
  two opaque audio URLs and a signed `voteToken`. The matchup is recoverable
  only by decoding the token server-side.
- Identities, per-side Elo deltas, and crowd-correctness are returned only by
  `submitVote` (`POST /api/vote`); the client builds the reveal entirely from
  that response and never holds the pre-vote identities.
- "Listen" samples on the leaderboard/table/chart pass the active battle's
  opaque token to `GET /api/sample`. The server decodes it and, if the
  requested model is one of the two in the battle, returns a clip on a
  DIFFERENT source voice, so a labeled sample can never match (and unmask) a
  blind card.
- Abuse resistance: single-use HMAC battle tokens, per-IP rate limiting, and a
  Turnstile challenge every Nth vote. The challenge cadence and rate caps are
  env-tuned so production values are not encoded in the public source.

## 7. The Human baseline

The Index includes one real-human reference "model": provider **Human**,
display name **Homo Sapien**, registered in `src/catalog/models.ts` with
`baseline: true`. It is not synthesized; the four source-voice actors read the
same 20 lines the TTS models read (see `src/pipeline/HUMAN-RECORDING.md`), and
its clips share the frozen content-hash scheme (`variant:voice-X:human:human`).

- It anchors the Humanness scale at **100**, the human reference point the
  field is measured against rather than a perfect-score ceiling. Its anchor
  Elo is seeded above the field in `seed-standings.json`, and `humannessScore`
  normalizes competitors against `max(baselineElo, topCompetitorElo)` so the
  human reads a clean 100 with a gap below it. The Elo that votes actually move
  is uncapped, so a model that listeners judge more human than the real person
  out-rates it and reaches the 100 mark (the human stays pinned at 100 as the
  reference).
- It is presentation-special: a distinct pinned top "baseline" row, excluded
  from the model/provider counts and from sort reordering, with dashes for
  latency/price, and excluded from the latency distribution chart.
- It battles TTS head to head ("which voice sounds more human?") but only on
  the voices it has recorded. As of this writing that is `voice-clara` and
  `voice-nelliot`; adding Emma or Godfrey is a one-line `sourceVoices` edit
  plus running the clip pipeline for that voice.

## 8. The clip pipeline

Everything clip-related lives in `src/pipeline/` and runs through `package.json`
scripts (Bun). It is maintainer-run and needs the licensed source voices and
provider keys (`src/pipeline/.env`, gitignored). See its
[RUNBOOK.md](src/pipeline/RUNBOOK.md) for the full operational detail and the
five-step model-onboarding sequence.

- Synthetic models: `humanness:clone` (register the four cloned voices),
  `humanness:clips` (generate + upload the 80 hash-named clips),
  `humanness:verify-clips` (registry-derived HEAD check), `humanness:ttfb`
  (the 50-trial first-audio bench).
- The Human baseline: `humanness:human-segment` (Deepgram nova-3 transcription
  + alignment to cut clean per-line clips from longer takes),
  `humanness:human-detap` / the clean chain (de-tap high-pass + light denoise),
  and `humanness:human-clips` (normalize, upload, HEAD-verify).

## 9. Infrastructure and environments

- Vercel project on this repo; preview deploys per PR; CI (`.github/workflows/`)
  runs typecheck, the test suite, and a production build on every push/PR.
- `BLOB_READ_WRITE_TOKEN` backs the durable vote store; without it votes go to
  an in-memory store seeded from the production export (fine for dev).
- `HUMANNESS_AUDIO_ORIGIN` overrides the default public audio origin.
- `HUMANNESS_BATTLE_TOKEN_SECRET` signs battle tokens (required in production).
- Turnstile (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`) and
  Upstash Redis are optional but recommended in production; PostHog analytics
  is optional and loads no code without a key. See `.env.example`.

## 10. Licensing

- Code and docs: Apache-2.0 (the patent grant matters in the TTS space).
- "The Humanness Index™" name and logo: Vapi trademarks, not covered by the
  code license. Forks must rename; see [TRADEMARKS.md](TRADEMARKS.md).
- Audio clips and source voices: licensed talent recordings, all rights
  reserved, served from our origin for the benchmark UI only. Never committed.
- Vote data and standings (the public leaderboard API): CC BY 4.0 with
  attribution to "The Humanness Index™ by Vapi".
- Provider logomarks in `public/marks/` belong to their owners and are used
  nominatively; no endorsement is implied.

## 11. Community model

- Issues: model requests (provider, model id, cloning support with a source,
  public API availability) and bug reports.
- PRs welcome on app code, registry copy corrections with sources, docs, and
  pipeline tooling. A PR cannot add a model end to end: clip generation
  requires the licensed source voices, so maintainers run the pipeline per
  [docs/ADDING_A_MODEL.md](docs/ADDING_A_MODEL.md). The fairness rationale
  (the same cloned voice on both sides of every battle) is documented in
  [docs/METHODOLOGY.md](docs/METHODOLOGY.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
