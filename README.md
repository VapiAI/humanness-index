# The Humanness Index™

The open benchmark for how human voice AI sounds, built and operated by
[Vapi](https://vapi.ai). Live at
[humannessindex.vapi.ai](https://humannessindex.vapi.ai).

Listeners hear two text-to-speech models read the same customer support
prompt with the same cloned voice, blind, and pick whichever sounds more
human. Rankings derive purely from those votes. This repository contains
the entire benchmark: the site, the vote backend, the Elo engine, the model
registry, and the clip/benchmark pipeline, so anyone can read exactly how
scores are produced.

## How scores work

- Blind, same-voice battles: both sides of every round speak with the same
  cloned source voice, so votes compare the models, not the voices. The
  battle carries no model identities until you vote (the server reveals them
  only in the vote response), so the test is truly blind.
- Human baseline: a real person ("Homo Sapien", provider "Human") reads the
  same lines and anchors the scale at 100, shown as a distinct top reference
  row. Every model scores as a share of that human mark.
- Pure-vote Elo: each (voice, model) variant carries an Elo rating updated
  per vote; a model's Humanness score is its Elo normalized across the field
  (the Human baseline anchors 100, the lowest model reads 0), with an
  uncertainty band that narrows as votes accumulate.
- Measured-only latency: every latency figure is the median of 50
  sequential live streaming trials from the in-repo bench. Vendor
  estimates are never shown.
- Cloning is the inclusion criterion: a model must support voice cloning
  to be listed, because the same-voice control depends on it.

The full write-up lives in [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Repository tour

```
app/                  Next.js App Router: /, /models/[slug],
                      /providers/[slug], /api/{models,battle,vote,sample}
src/catalog/          model + provider registry (single source of truth)
src/server/           arena service, Elo engine, vote store, battle tokens,
                      rate limiting, Turnstile
src/components/       page sections + detail-page islands
src/lib/ src/hooks/   client data layer, scoring, visualizers
src/data/             first-paint derivations of the registry + seed export
src/pipeline/         maintainer-run clip generation, upload, verification,
                      and the 50-trial TTFB bench (see its RUNBOOK.md)
docs/                 methodology + the public add-a-model checklist
```

## Local development

Requires [Bun](https://bun.sh).

```sh
bun install     # also generates the empty private registry overlay
bun run dev     # http://localhost:3000
```

That is all it takes: without any env vars the app serves battles from an
in-memory vote store seeded with the production standings export, and audio
streams from the public clip origin. Votes reset on restart.

```sh
bun run check-types   # tsc
bun test              # registry, Elo, store, token, and route suites
bun run build         # production build
```

`.env.example` documents the production environment: the Vercel Blob vote
store, the battle-token secret, the audio origin override, optional
Turnstile keys, and optional PostHog analytics (the app is fully functional
without any of them; analytics stays dormant without a key).

## Contributing

Issues for model requests and bugs, PRs for app code, registry copy
corrections with sources, docs, and pipeline tooling. PRs cannot add a
model end to end: clip generation requires our licensed source voices, so
maintainers run the pipeline per
[docs/ADDING_A_MODEL.md](docs/ADDING_A_MODEL.md). See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licensing

- Code and docs: [Apache-2.0](LICENSE).
- "The Humanness Index™" name and logo: Vapi trademarks, not covered by the
  code license. Forks must rename; see [TRADEMARKS.md](TRADEMARKS.md).
- Audio clips and source voices: licensed talent recordings, all rights
  reserved, served from our origin for the benchmark UI only. Never
  committed to this repository.
- Vote data and standings (the public leaderboard API): CC BY 4.0 with
  attribution to "The Humanness Index™ by Vapi".
- Provider logomarks in `public/marks/` belong to their respective owners
  and are used nominatively; no endorsement is implied.

## Contact

[humannessindex@vapi.ai](mailto:humannessindex@vapi.ai)
