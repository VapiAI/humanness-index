# Cartesia: correct the transport, pin dated snapshots, stage Sonic 3.6

Hi folks. Cartesia here. Sonic 3.6 went GA on 2026-08-14, and while putting together
the details to get it onto the Index we read through `src/pipeline` and found a few
things in the Cartesia orchestration that are holding our numbers below what the
models actually do. This PR fixes those and stages 3.6 for you to generate.

`bun run check-types`, `bun test` (125 pass), and `bun run build` are all green.

## The headline issue: the 3.5 clips were generated against 3.0 voices

The four arena voices (Clara, Emma, Godfrey, Nelliot) are Pro Voice Clones. A PVC is
a fine-tune of one specific base model, and at the time the Sonic 3.5 clips were
generated those four voices only had fine-tunes for `sonic-3-2026-01-12`. There was
no 3.5 fine-tune to serve, so the 3.5 generations did not run on a 3.5-quality voice.
That is a real handicap in a blind listening test, and it is on us for not flagging it
when the clips were cut.

All four now have fine-tunes across the line:

| Voice | Voice ID | Fine-tune | Model availability |
| --- | --- | --- | --- |
| Clara | `a5d537b0-4a5f-464d-ac12-d143fe1a0a36` | `fine_tune_JNfFhUJYN5T8ChazR9gArt` | `sonic-3-2026-01-12`, `sonic-3.5-2026-05-04`, `sonic-3.6-2026-08-14` |
| Emma | `2206880c-55e3-445a-a83c-fa2196a9f304` | `fine_tune_7ra9vSuVGP7zvbiw5cf7jx` | `sonic-3-2026-01-12`, `sonic-3.5-2026-05-04`, `sonic-3.6-2026-08-14` |
| Godfrey | `589d6fbc-d04d-46c3-91e4-a97979eca151` | `fine_tune_jE6P5njqyJmFwtYZw1MnLW` | `sonic-3-2026-01-12`, `sonic-3.5-2026-05-04`, `sonic-3.6-2026-08-14` |
| Nelliot | `621a0684-2a58-4693-b762-a54093bf0c4c` | `fine_tune_UmPnKL6QqmDM6AoFbmHufV` | `sonic-3-2026-01-12`, `sonic-3.5-2026-05-04`, `sonic-3.6-2026-08-14` |

This is the documented forward-fill behavior: *"A Pro Voice Clone starts out supported
on the TTS model it was trained on. As Cartesia releases newer models, we automatically
make your voice available on them."*
([Pro voice clone guide](https://docs.cartesia.ai/build-with-cartesia/capability-guides/clone-voices-pro))

**The ask: re-run the Sonic 3.5 clip generation.** Nothing else in this PR matters as
much as that. Same voices, same prompts, same protocol; they will now be served by 3.5
fine-tunes instead of 3.0 ones.

## Changes by file

### `src/pipeline/transports/cartesia.ts`

Four fixes.

**1. One API version pin, and a current one.** `synthesize` sent
`cartesia-version: 2024-11-13` while `ttfbPlanFor` sent `2025-04-16`, so the two paths
were exercising different request contracts. Both now send `2026-08-14`, our current
published version ([API conventions](https://docs.cartesia.ai/use-the-api/api-conventions)).

We checked the version-gated validation before proposing the bump; your existing
payloads satisfy every gate, so this is safe:

| Gate | Your payload | Result |
| --- | --- | --- |
| `>= 2026-03-01` requires `voice.id`, rejects embeddings | `voice: { mode: 'id', id }` | passes |
| SSE/WS must use the `raw` container | WS sends `raw`/`pcm_s16le`; mp3 only on `/tts/bytes` | passes |
| `>= 2026-08-14` ignores deprecated top-level `speed` | never sets `speed` | no-op |
| `/tts/bytes` rejects timestamp flags | none requested | passes |

One behavior change worth knowing: at `>= 2026-03-01` our HTTP and WS errors become
structured JSON (`error_code`, `title`, `message`, `request_id`) instead of plain
`Title: Message` text. `throwForStatus` reads the body as text, so it keeps working and
gets strictly more informative. The WS `jsonError` predicate still matches, since the
structured error event retains `type: "error"`.

**2. `Authorization: Bearer` instead of `x-api-key`.** `synthesize` and the clone path
used `x-api-key`; the TTFB path already used Bearer. Bearer is the documented scheme for
all endpoints. Both forms authenticate today, but this removes the inconsistency.

**3. `synthesize` now sends `language: 'en'`.** It was omitted, which means we ran
language auto-detection on every arena clip. Detection reads the transcript and can pick
wrong on short or ambiguous lines, and a mis-detected language changes the phonology the
model reads with. The TTFB path already passed `language`. All 20 arena prompts are
English and all four source voices are English, so this is deterministic now.

**4. The TTFB bench uses a stock voice.** It benched on Clara, an arena PVC, while every
other provider on the table is benched on a stock voice. That put a cloned-voice lookup
inside our measured path that no other row pays. Now uses
`f786b574-daa5-4673-aa0c-cbe3e8534c02`, the stock voice from our
[realtime TTS quickstart](https://docs.cartesia.ai/get-started/realtime-text-to-speech-quickstart).

Flagging plainly: this one moves our own published latency number, and we do not know
which way. It is a methodology correction, not a favor to us. Sonic 3.5 currently shows a
measured 128 ms median that was produced under the old setup, so that figure should be
re-benched before it is quoted again.

**5. `createClone` now creates an actual Pro Voice Clone.** It called `/voices/clone`,
which is an **Instant** Voice Clone built from a single ~10 second clip. IVC and PVC are
different products at meaningfully different fidelity, and the four voices in the arena
are PVCs, so the function could never have reproduced them. It now follows the documented
four-step flow:

1. `POST /datasets`
2. `POST /datasets/{id}/files` for **every** sample, not just `sampleFiles[0]` (a PVC
   trains on the whole dataset and needs 30+ minutes of audio; 2 hours or more is better)
3. `POST /fine-tunes`
4. poll `GET /fine-tunes/{id}` until `status` is `completed`, then
   `GET /fine-tunes/{id}/voices`

Steps 3 and 4 are separate on purpose: `POST /fine-tunes` returns a fine-tune, not a
voice. The voice only exists once training finishes, which takes up to 3 hours, so the
function polls every 30s with a 4h ceiling. On timeout it reports the fine-tune id and
tells you to re-attach rather than start over, because **PVC fine-tunes consume a plan
slot** (Startup: 2, Scale: 4).

Note this path needs a Startup plan or above and 30+ minutes of audio per voice, so it
is not a drop-in for the IVC-shaped call it replaces. It is here so the code matches what
the arena voices actually are.

### `src/pipeline/transports/http.ts`

Added `postFormNoContent`. `POST /datasets/{id}/files` answers `204 No Content`, and the
existing `postFormForJson` would throw parsing an empty body.

### `src/catalog/models.ts`

**Pinned Sonic 3.5 to a dated snapshot.** `apiModelId` and `arenaApiId` move from
`sonic-3.5` to `sonic-3.5-2026-05-04`.

Being straight about what this does and does not do: the bare `sonic-3.5` alias resolves
to `sonic-3.5-2026-05-04` today, so **this does not change which weights answer the
request**. The value is that it cannot drift. We repoint bare aliases over time, and
`sonic-latest`, `sonic-3-latest`, and `sonic-preview` have all already been repointed to
the 3.6 snapshot. A benchmark that quotes an alias is quoting a moving target; a dated
snapshot is reproducible a year from now.

**We know `arenaApiId` is frozen identity, and we are asking you to break that freeze.**
Per CONTRIBUTING it feeds the audio content hashes, so changing it re-derives the paths
for the Cartesia 3.5 clips:

- `variant:voice-emma:cartesia:sonic-3.5|clip-20` → `5e21eefd…815d`
- `variant:voice-emma:cartesia:sonic-3.5-2026-05-04|clip-20` → `3e36a188…de03`

The 20 clips currently hosted under the old hashes would be orphaned. We are proposing it
anyway **only because those clips are being regenerated regardless** for the reason at the
top of this PR: the current ones were cut against 3.0 fine-tunes. New clips get uploaded
under the new hashes and nothing is stranded. If you would rather keep `arenaApiId` frozen
at `sonic-3.5` and pin only `apiModelId`, that works too and we will take it. The
regeneration is the part that matters. We have updated the goldens either way so the
suite is green as submitted.

`slug` is untouched, so `/models/cartesia-sonic-3-5` keeps working.

**Copy corrections.** Two places called 3.5 "Cartesia's current flagship", which stopped
being true on 2026-08-14. Updated both, sources retained.

### `src/catalog/catalog.test.ts`

Updated the pinned `EXPECTED_MODELS` arenaId and the `voice-nelliot` golden hash to match
the re-derived identity. No count bumps: staging 3.6 in the pipeline rather than the
registry leaves the 88-variant matrix untouched.

### `src/pipeline/models.ts`

Staged Sonic 3.6 as a `NEW_MODELS` row so `humanness:generate cartesia-sonic-36` works
without a registry edit. We followed your sequencing rule here rather than registering it
directly, since CONTRIBUTING is explicit that clips are generated before registration and
that maintainers run that pipeline.

`arenaApiId` is the dated `sonic-3.6-2026-08-14` rather than a bare `sonic-3.6` for a
concrete reason: **there is no bare `sonic-3.6` alias.** Our alias list stops at
`sonic-3.5`. 3.6 is reachable only by the dated id, or via `sonic-latest` /
`sonic-3-latest` / `sonic-preview`, all of which currently resolve to it and all of which
will move again. Since `arenaApiId` is frozen forever once clips are hashed, the dated id
is the only value that will still mean this model later.

### `src/catalog/providers.ts`, deliberately unchanged

We had "add pricing" on our list, then found pricing is encoded per **provider**, not per
model, and the Cartesia entry already carries it with the note "Same credit rate for every
Sonic." That note is still accurate for 3.6, so a per-model field would be redundant. The
`asOf` is 2026-06-10; if you want it refreshed we will send current numbers with a source
rather than have you chase them.

## Ready to register when the clips land

Once 3.6 clips are generated and verified, this drops into `src/catalog/models.ts` and the
`NEW_MODELS` row above gets deleted. `latencyMs` is left `null` deliberately: your house
rule is measured-only, and only you can run the bench.

```ts
{
  id: 'cartesia-sonic-36',
  slug: 'cartesia-sonic-3-6',
  providerId: 'cartesia',
  name: 'Sonic 3.6',
  apiModelId: 'sonic-3.6-2026-08-14',
  arenaApiId: 'sonic-3.6-2026-08-14',
  status: 'active',
  releaseDate: {
    value: '2026-08-14',
    sourceUrl: 'https://docs.cartesia.ai/build-with-cartesia/tts-models/latest',
    asOf: '2026-08-26',
    note: 'Snapshot release, general availability.',
  },
  stats: {
    latencyMs: null, // measured-only: needs your bench run
  },
  voiceProfile: 3,
  sample: {
    fallbackClip: clip(
      'voice-emma',
      'cartesia',
      'sonic-3.6-2026-08-14',
      'clip-20',
      'b70ab872a402c56c37c6367c290c062f',
    ),
  },
  copy: [
    {
      heading: 'Background',
      paragraphs: [
        'Sonic 3.6 is Cartesia\'s current flagship, generally available since August 2026. It is an update to Sonic 3.5 that improves naturalness across all supported languages, and it keeps the state space model architecture and the 42 language coverage of the 3.x line.',
      ],
      sourceUrls: [
        'https://docs.cartesia.ai/build-with-cartesia/tts-models/latest',
      ],
    },
  ],
  faq: [HOW_TESTED('Sonic 3.6')],
},
```

The `fallbackClip` hash above is derived from the frozen identity, so it will resolve
once the clip exists. Registering it also bumps the pinned counts in `catalog.test.ts`.

## What we are asking for

1. Re-run Sonic 3.5 clip generation against the current PVC fine-tunes. This is the one
   that changes the ranking.
2. Generate and register Sonic 3.6.
3. Re-bench Cartesia TTFB after the stock-voice change, and treat the existing 128 ms
   figure as stale.

Happy to jump on a call, and happy to be told no on the `arenaApiId` change specifically.
