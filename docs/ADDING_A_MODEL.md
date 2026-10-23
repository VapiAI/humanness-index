# Adding voices and models

The Index measures whether a voice can pass as a real person in
conversation, so every model is judged on the same cloned source voices (see
the fairness rationale in `docs/METHODOLOGY.md`). Anyone can propose a model;
maintainers run the audio pipeline because it needs the licensed source
voices and our provider accounts. For deeper detail, see
`src/pipeline/RUNBOOK.md` (provider quirks and history) and the checklist at
the top of `src/catalog/models.ts`.

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

Everything below is the maintainer guide.

## Where everything lives

| What | Where | Notes |
| --- | --- | --- |
| Code | [github.com/VapiAI/humanness-index](https://github.com/VapiAI/humanness-index) | Public repo. CI runs typecheck, tests and build on every PR. |
| Hosting | Vercel, Vapi team, project `humanness-index` | Every PR gets a preview deploy. Merging to `main` deploys production. |
| Clip storage | Vercel Blob store `store_BKVLbh5qPhzaeN1w` | Served from `https://bkvlbh5qphzaen1w.public.blob.vercel-storage.com`, one file per clip at `audio/{hash}.mp3`. The same store holds the live vote log. |
| Source voices | The Vapi Voice Eval folder in Google Drive (maintainers only) | Clara, Emma, Godfrey and Nelliot are the four arena voices (32 licensed recordings). The Elliot folder is not part of the arena. |
| Provider API keys | Each provider's own console | Not stored in Vercel or the repo. Use the team account that holds the existing clones; ask Jordan for access. |
| Pipeline secrets | `src/pipeline/.env` (gitignored) | Every key name is listed in `src/pipeline/.env.example`. |

## One-time setup

1. Install Bun, ffmpeg (`brew install ffmpeg`) and the Vercel CLI
   (`npm i -g vercel`).
2. Clone and install: `git clone https://github.com/VapiAI/humanness-index`,
   then `bun install` inside it.
3. Link the Vercel project:
   `vercel link --yes --scope vapi --project humanness-index`
4. Create the pipeline secrets file:
   `cp src/pipeline/.env.example src/pipeline/.env`
5. Get the Blob token: run `vercel env pull`, move the
   `BLOB_READ_WRITE_TOKEN` line from the new root `.env.local` into
   `src/pipeline/.env`, and delete it from `.env.local`. Left at the root, it
   makes `bun run dev` use the live vote store over the network instead of a
   local in-memory one.
6. Add the API key for each provider you are working with to
   `src/pipeline/.env`.
7. Download the Clara, Emma, Godfrey and Nelliot folders from the Vapi Voice
   Eval Drive folder into `src/pipeline/results/source-voices/originals/` as
   `clara/`, `emma/`, `godfrey/` and `nelliot/` (lowercase). That path is
   gitignored: licensed audio never goes in git.
8. Check everything runs: `bun run check-types && bun test`, then
   `bun run dev` and open `http://localhost:3000`.

## Pick your path

| Situation | Path |
| --- | --- |
| New model from a provider already in the Index (for example a new ElevenLabs or Cartesia model) | Standard path. Skip the transport and cloning steps: the four clones already exist on that provider. |
| New provider whose API supports voice cloning | Standard path, including the transport and cloning steps. |
| Provider cannot give us API access, or gates cloning behind manual approval | Vendor-rendered clip set. |
| Model cannot clone a voice | Not eligible. Every model is judged on clones of the same four voices, so cloning is the entry requirement. |

## Standard path

Order matters: the clips must be uploaded and verified before the registry
entry merges, because battles can serve a model the moment it is in the
registry.

### Choose the ids

Add a row to `NEW_MODELS` in `src/pipeline/models.ts` with `id`, `slug`,
`providerId`, `arenaApiId`, `vendorModelId`, `name` and `registered: false`.
Once clips are generated, `id`, `slug` and `arenaApiId` can never change,
because they feed the URLs and the clip addresses. Follow the existing
pattern, for example Fish S2.1-Pro: id `fish-s21-pro`, arenaApiId `s2-1-pro`
(no dots), vendorModelId `s2.1-pro` (the exact string the vendor API takes).

### Add a transport (new provider only)

Create `src/pipeline/transports/<provider>.ts` implementing
`ProviderTransport` (`synthesize`, `createClone`, `ttfbPlanFor`), register it
in `transports/index.ts`, and add its key name to `src/pipeline/.env.example`.
Start from the closest existing transport: `cartesia.ts` or `smallest.ts` for
HTTP streaming, `xai.ts` for a WebSocket API. Benchmark on the provider's
lowest-latency streaming mode (raw PCM where it is offered), since that is
how every other model is measured.

A new provider also needs a `ProviderEntry` in `src/catalog/providers.ts` and
a logo file in `public/marks/`.

### Clone the four voices (new provider only)

```sh
bun run humanness:clone <provider> src/pipeline/results/source-voices/originals
```

The new clone ids are saved to `src/pipeline/voices.local.json`, which is
gitignored. Copy them into `STATIC_CLONED_VOICE_IDS` in
`src/pipeline/voices.ts` as well, so anyone can regenerate clips later. The
Inworld, Smallest.ai and Neuphonic ids are not in the repo yet; if you need
them, they are in each provider's console.

Some providers cap sample length (Neuphonic 3 to 10 seconds, Smallest.ai 5 to
15 seconds and 5 MB). For those, trim one clean excerpt per voice into a
separate folder and point the command at that. Where cloning is console-only
(Hume), create the clones by hand and save the ids with
`--record voice-clara=<id> voice-emma=<id> voice-godfrey=<id> voice-nelliot=<id>`.

### Generate and upload the clips

Do a small trial first, then the full run:

```sh
bun run humanness:clips <model-id> --voices clara --limit 3
bun run humanness:clips <model-id> --upload
```

The full run renders 80 clips (four voices by 20 lines) into
`src/pipeline/results/clips/<model-id>/`, uploads them, and checks that every
one resolves; exit code 0 means they all do. Listen to a spread of them
before moving on. Models fail in odd ways: Smallest.ai once read most of a
line, cut off the final question, then screamed for 87 seconds.

Never upload placeholder audio. Uploads skip any clip that already exists, so
a placeholder would block the real clip later.

### Benchmark latency

```sh
bun run humanness:ttfb <model-id>
```

This runs 50 sequential trials after two warm-ups. The median goes in the
registry entry as `pipelineTtfb(<median>, '<note>', '<YYYY-MM-DD>')`. The run
overwrites `src/pipeline/results/ttfb_results_50trial.json`, so copy that
file aside first if it holds anything you need. If a long HTTP benchmark
hangs partway, run it in slices (`--trials 10`) in fresh processes and
combine the results.

Latency is measured by us or left blank. If the model has no reachable API,
the entry keeps `latencyMs: null` and the site shows a dash. Never use a
vendor's published number.

### Register the model

Add the entry to `src/catalog/models.ts` at the end of its provider's group.
Copying a recent entry is the quickest route; Speechify Simba 3.2 and Fish
S2.1-Pro are good templates. Each entry needs:

- `id`, `slug` and `arenaApiId` matching the `NEW_MODELS` row, plus
  `apiModelId`, `name` and `status: 'active'`
- `releaseDate` and `stats` (latency, languages, voice cloning and so on),
  each with a `sourceUrl` and an `asOf` date
- `voiceProfile`: an integer no other entry uses
- `sample.fallbackClip`: `clip(voice, provider, arenaApiId, promptId, hash)`,
  with the hash taken from `manifest.json` in the model's clips folder
- at least two `copy` blocks and two `faq` entries (`HOW_TESTED('<name>')`
  plus one of your own), with no em dashes anywhere

Then, in `src/catalog/catalog.test.ts`, bump the pinned model counts (and the
provider counts for a new provider) and add the id to `UNSEEDED_MODEL_IDS`.
The `NEW_MODELS` row in `src/pipeline/models.ts` can be deleted once the
entry exists.

If the model is under embargo, do not commit it to the repo, which is public.
Talk to Jordan about the private registry overlay instead.

### Check it locally

```sh
bun run check-types && bun test
bun run humanness:verify-clips <model-id>
```

Then run `bun run dev` and check that the table lists the model, battles pair
it, its Listen sample plays, and `/models/<slug>` renders.

### Ship it

Open a PR. CI runs typecheck, tests and build, and Vercel posts a preview
link. Merging to `main` deploys production. Once it is live, run
`bun run scripts/audit-blindness.ts` to confirm battles are still blind. It
fails if a new model's clips reached the store in a format no other model
uses, which would let someone identify the model from the file header.

New models start at a provisional rating of 1200. Rankings refit every 50
votes and the public table is cached for an hour, so a new model's position
takes a while to settle. `scripts/recompute-standings.ts` forces a refit, but
it reads the entire vote log from Blob. Bulk reads at full speed have tripped
Vercel's DDoS protection before, which blocked all audio on the site, so
don't run it casually.

## Vendor-rendered clip sets

When a provider cannot give us API access, it can render the 80 clips
itself. Speechify Simba 3.2, Fish S2.1-Pro and Gradium all came in this way.

- Send the provider the four source voices and the 20 lines (in
  `src/pipeline/prompts.ts`, and as a script in
  `src/pipeline/HUMAN-RECORDING.md`). Ask for one folder per voice with files
  `clip-01` to `clip-20`, for example `voice-clara/clip-01.mp3`.
- Check the delivery before ingesting it. Folder names are not proof of which
  voice is inside: the Fish set arrived with an extra Elliot folder.
  Transcribe the clips (whisper-cpp works) to confirm each one reads its
  line, and look for any clip far too long or short for its line.
- Run `bun run humanness:vendor-clips <model-id> <folder>` to validate and
  convert locally, then the same command with `--upload`. It refuses to
  upload anything unless all 80 clips are present.
- Register the model as normal. Its copy must say the clips were
  vendor-rendered. Latency stays null unless you have a key to benchmark
  with; if you don't, add the provider to `UNMEASURABLE_PROVIDERS` in
  `src/pipeline/transports/index.ts` with the reason.

## Voices

Every model in the Index is heard through clones of the same four licensed
voices: Clara, Emma, Godfrey and Nelliot. That shared roster is what makes
battles fair, so it is frozen.

- The Human baseline (shown as "Homo Sapien") is the four voice actors
  reading the same 20 lines. To replace a take, put the new recording under
  `src/pipeline/results/source-voices/human-readings/<voice>/` and run
  `bun run humanness:human-clips --voices <voice> --upload --overwrite`. The
  full recording, cutting and cleaning flow is in the RUNBOOK.
- Adding a fifth source voice is a much larger change. The roster is defined
  in `src/catalog/voices.ts`, `src/pipeline/voices.ts` and
  `src/server/catalog.ts`, and every model serves the whole roster by
  default. A new voice therefore needs a clone on every provider and 20 new
  clips for every model, or a `sourceVoices` restriction on each model
  without them. Talk to Jordan before starting one.

## Rules that don't bend

- `id`, `slug` and `arenaApiId` never change once clips exist.
- Clips are uploaded and verified before the registry entry merges.
- Latency is measured by us or left blank.
- Every fact in the registry has a `sourceUrl` and an `asOf` date.
- No em dashes in registry copy; the tests check.
- Licensed audio (source voices and clips) never goes in git.

## When something breaks

- `Missing required env var X`: the key is not in `src/pipeline/.env`.
- `Provider X is missing cloned voice ids`: clone the voices, save
  console-made ids with `--record`, or add the ids to
  `src/pipeline/voices.ts`.
- Provider-specific problems (rate limits, sample limits, unusual
  endpoints): the Provider quirks section of `src/pipeline/RUNBOOK.md` covers
  every provider already in the Index.
