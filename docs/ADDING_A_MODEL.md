# Adding a model to the Index

The Index measures whether a voice can pass as a real person in
conversation, so every model is judged on the same cloned source voice (see
the fairness rationale in `docs/METHODOLOGY.md`). This is the public version
of the maintainer checklist: anyone can propose a model, and maintainers run
the audio pipeline because it requires the licensed source voices.

## Propose a model (anyone)

Open a GitHub issue with:

- Provider and model id (the vendor's published id).
- Voice cloning support, with a link to the vendor's cloning docs. Cloning
  is the inclusion criterion: no cloning, no fair same-voice battle, no
  listing.
- Public API availability (the latency bench needs a reachable endpoint;
  models without one list with a dash).
- Anything notable about pricing, languages, or release timing, with
  sources.

You can also stage registry research in a PR: copy blocks, FAQ entries,
sourced stats. Every fact needs a `sourceUrl` and `asOf` date.

## Register the model (maintainers)

The five frozen steps, in order. The full operational detail lives in
`src/pipeline/RUNBOOK.md`.

1. Clone the four source voices on the provider (`bun run humanness:clone`),
   persisting ids to the gitignored `voices.local.json`.
2. Generate and upload the model's 80 clips (4 voices x 20 prompts), named
   by the frozen content-hash scheme, and verify every hash resolves on the
   audio origin (`bun run humanness:clips <model-id> --upload`). Clips must
   be hosted and verified BEFORE the registry change lands; the moment the
   registry includes a model, battles can serve it.
3. Add the registry entry in `src/catalog/models.ts` (plus a provider entry
   and logomark if the provider is new) following the checklist in that
   file's header: frozen id/slug/arenaApiId, a unique voiceProfile seed, a
   pinned fallback clip, sourced stats, at least two copy blocks and two
   FAQ entries, no em dashes. Bump the pinned counts in
   `src/catalog/catalog.test.ts` and run `bun run check-types && bun test`.
4. Benchmark TTFB with the 50-trial protocol (`bun run humanness:ttfb`) and
   record the median as `pipelineTtfb(<median>)`. Measured-only: if there
   is no reachable API, the entry keeps `latencyMs: null`.
5. Browser-check the dev server: the table shows the model, battles pair
   it, its Listen sample plays, and `/models/<slug>` renders.

New models enter at Elo 1200 on their first live votes; no seed row is
required.

## Frozen identity rules

Once a model is live, these never change (they feed URLs and the audio
content hashes that address the hosted clips):

- `id` (matches the vote store and API rows)
- `slug` (the public URL segment)
- `arenaApiId` (feeds variant ids and clip hashes)
