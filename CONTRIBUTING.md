# Contributing

Thanks for your interest in The Humanness Index™. The benchmark's
credibility depends on the code being open and the methodology being
reproducible, so contributions are welcome and held to that bar.

## What we welcome

- App code: bug fixes, accessibility, performance, UI polish.
- Registry COPY corrections with sources: pricing, language counts,
  release dates, and editorial copy in `src/catalog/` all carry `Sourced`
  provenance. Corrections must cite a public source URL.
- Documentation improvements.
- Pipeline tooling: transports, benchmarking, verification.
- Model suggestions: open an issue with the provider, the model id, whether
  it supports voice cloning (with a source), and whether the API is
  publicly available.

## What a PR cannot do: add a model end to end

Every battle plays the same cloned source voice through both models, which
is what makes the comparison fair. Generating a new model's clips therefore
requires our licensed source voices and our provider accounts, and those
never leave the maintainers. PRs can stage everything around a model
(registry research, copy, transports), but maintainers run the clip
pipeline and register the entry per `docs/ADDING_A_MODEL.md`.

## House rules

- No em dashes in copy or docs (enforced by tests for registry copy).
- Latency is measured-only. Never add a vendor latency estimate.
- Frozen identity: model `id`, `slug`, and `arenaApiId` values never
  change once live. They feed URLs and audio content hashes.
- Every claimed fact in the registry carries a `sourceUrl` and `asOf` date.

## Development

```sh
bun install        # also generates the empty private overlay
bun run dev        # http://localhost:3000
bun run check-types
bun test
bun run build
```

The app runs fully offline-capable for development: without
`BLOB_READ_WRITE_TOKEN` votes go to an in-memory store seeded from the
production export, and audio plays from the public clip origin. See
`.env.example` for the full environment story.

## Before you open a PR

1. `bun run check-types` is clean.
2. `bun test` is green (the registry suite enforces provenance, frozen
   identity, and copy rules).
3. `bun run build` succeeds.
4. If you touched registry counts, you bumped the pinned counts in
   `src/catalog/catalog.test.ts` intentionally and said so in the PR.

## Conduct

Be kind, assume good faith, and keep discussion technical. Report conduct
issues to humannessindex@vapi.ai.
