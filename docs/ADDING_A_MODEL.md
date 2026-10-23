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
| Code | [github.com/VapiAI/humanness-index](https://github.com/VapiAI/humanness-index) | Public repo. GitHub Actions is turned off, so nothing runs the tests for you (see Ship it). |
| Hosting | Vercel, Vapi team, project `humanness-index` | Every PR gets a preview deploy. Merging to `main` deploys production. |
| Clip storage | Vercel Blob store `store_BKVLbh5qPhzaeN1w` | Served from `https://bkvlbh5qphzaen1w.public.blob.vercel-storage.com`, one file per clip at `audio/{hash}.mp3`. The same store holds the live vote log. |
| Source voices | The Vapi Voice Eval folder in Google Drive (maintainers only) | Clara, Emma, Godfrey and Nelliot are the four arena voices (32 licensed recordings). The Elliot folder is not part of the arena. |
| Provider API keys | Each provider's own console | Not stored in Vercel or the repo. See setup step 7. |
| Pipeline secrets | `src/pipeline/.env` (gitignored) | Every key name is listed in `src/pipeline/.env.example`. |

## One-time setup

1. Install Bun 1.3 or newer, ffmpeg (`brew install ffmpeg`) and the Vercel
   CLI (`npm i -g vercel`). Older Bun stalls partway through long latency
   benchmarks.
2. Clone and install: `git clone https://github.com/VapiAI/humanness-index`,
   then `bun install` inside it.
3. Sign in to Vercel with your Vapi account: `vercel login`
4. Link the Vercel project:
   `vercel link --yes --scope vapi --project humanness-index`
5. Create the pipeline secrets file:
   `cp src/pipeline/.env.example src/pipeline/.env`
6. Get the Blob token: run `vercel env pull`, move the
   `BLOB_READ_WRITE_TOKEN` line from the new root `.env.local` into
   `src/pipeline/.env`, and delete it from `.env.local`. Left at the root, it
   makes `bun run dev` use the live vote store over the network instead of a
   local in-memory one.
7. Add provider API keys to `src/pipeline/.env`. For a provider already in
   the Index, the existing voice clones live in Vapi's account with that
   provider, so ask Jordan for that account's key rather than making your
   own. For a new provider, sign up with your Vapi email and use that key.
   Human-baseline work also needs a Deepgram key (`DEEPGRAM_API_KEY`).
8. Download the Clara, Emma, Godfrey and Nelliot folders from the Vapi Voice
   Eval Drive folder into `src/pipeline/results/source-voices/originals/` as
   `clara/`, `emma/`, `godfrey/` and `nelliot/` (lowercase). Skip the two
   "Copy of" files in Godfrey; they duplicate the originals. That path is
   gitignored: licensed audio never goes in git.
9. Check everything runs: `bun run check-types && bun test`, then
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

If the model is under embargo, keep all of this on a local branch and don't
push it until the provider announces. You can upload its clips early: their
addresses can't be guessed without the model id.

### Choose the ids

Add a row to `NEW_MODELS` in `src/pipeline/models.ts` with `id`, `slug`,
`providerId`, `arenaApiId`, `vendorModelId`, `name` and `registered: false`.
Once clips are generated, `id`, `slug` and `arenaApiId` can never change,
because they feed the URLs and the clip addresses. Follow the existing
pattern, for example Fish S2.1-Pro: id `fish-s21-pro`, slug `fish-s2-1-pro`,
arenaApiId `s2-1-pro` (no dots), vendorModelId `s2.1-pro` (the exact string
the vendor API takes).

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

The original recordings are long (Nelliot is a single 115 MB file), and most
clone APIs only take a short sample. Check the provider's limits, then cut
one clean excerpt per voice into a separate folder with the same four
subfolders:

```sh
mkdir -p clone-samples/clara
ffmpeg -ss 30 -t 10 -i "src/pipeline/results/source-voices/originals/clara/<recording>.mp3" -ac 1 clone-samples/clara/clara.wav
```

Pick a stretch with clean speech and no long pauses, and listen to it before
cloning. Most transports only send the first file in each voice folder, so
put exactly one file in each. Known limits: Smallest.ai 5 to 15 seconds and
5 MB, Neuphonic 3 to 10 seconds. Then:

```sh
bun run humanness:clone <provider> clone-samples
```

The new clone ids are saved to `src/pipeline/voices.local.json`, which is
gitignored. Copy them into `STATIC_CLONED_VOICE_IDS` in
`src/pipeline/voices.ts` and commit them, so anyone can regenerate clips
later. Where cloning is console-only (Hume), create the clones by hand and
save the ids with
`bun run humanness:clone <provider> --record voice-clara=<id> voice-emma=<id> voice-godfrey=<id> voice-nelliot=<id>`.

The Inworld, Smallest.ai and Neuphonic clone ids from earlier runs are not in
the repo yet. If you need one of those providers, recover them first:
`bun run humanness:clone inworld --list` prints Inworld's, and the
Smallest.ai and Neuphonic consoles list theirs under the names Arena Clara,
Arena Emma, Arena Godfrey and Arena Nelliot. Save them with `--record` and
add them to `src/pipeline/voices.ts`.

### Generate and upload the clips

Render locally first, listen, then upload:

```sh
bun run humanness:clips <model-id> --voices clara --limit 3   # quick check that the key and transport work
bun run humanness:clips <model-id>                            # all 80 clips, local only
bun run humanness:clips <model-id> --upload                   # upload and verify
```

The local run writes 80 clips (four voices by 20 lines) to
`src/pipeline/results/clips/<model-id>/`, named by hash; `manifest.json` in
that folder says which file is which voice and line. Listen to a spread of
them. Models fail in odd ways: Smallest.ai once read most of a line, cut off
the final question, then screamed for 87 seconds. To redo a bad clip, delete
its file and run the local command again; only missing clips are
regenerated.

The upload run sends the local files and checks that every clip resolves;
exit code 0 means they all do. Once a clip is hosted, the pipeline will not
replace it, so never upload placeholder audio and always listen before
uploading.

### Benchmark latency

```sh
bun run humanness:ttfb <model-id>
```

This runs 50 sequential trials after two warm-ups and prints the median. It
goes in the registry entry as
`pipelineTtfb(<median>, '<how it was measured>', '<YYYY-MM-DD>')`. The run
overwrites `src/pipeline/results/ttfb_results_50trial.json`, so copy that
file aside first if it holds anything you need.

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

`src/catalog/catalog.test.ts` pins the whole catalog on purpose, so
`bun test` will fail until you update it. For a new model:

- add it to `EXPECTED_MODELS`, in the same position as in `models.ts`
- add its id to `UNSEEDED_MODEL_IDS` and its slug to the slug checks
- add one to each model count (`BASE_MODEL_ENTRIES`, `arenaModelEntries`,
  `listedModelEntries`) and four to `VARIANTS.length`

A new provider also goes in `EXPECTED_PROVIDERS`, the provider marks map and
the provider slug table, and adds one to each provider count. Each failing
test names the line to change.

The `NEW_MODELS` row in `src/pipeline/models.ts` can be deleted once the
entry exists.

### Check it locally

```sh
bun run check-types && bun test && bun run build
bun run humanness:verify-clips <model-id>
```

Then run `bun run dev` and check that the table lists the model, battles pair
it, its Listen sample plays, and `/models/<slug>` renders.

### Ship it

Open a PR. Vercel builds a preview and posts the link, but that build only
runs `next build`. GitHub Actions is turned off on this repo, so the
workflow in `.github/workflows/ci.yml` does not run and nothing else checks
the PR: the local checks above are the gate. Merging to `main` deploys
production straight away. Once it is live, run
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
  Transcribe the clips to confirm each one reads its line
  (`brew install whisper-cpp`, plus the `ggml-base.en.bin` model from
  huggingface.co/ggerganov/whisper.cpp), and look for any clip far too long
  or short for its line.
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
battles fair.

### The Human baseline

The Human baseline (shown as "Homo Sapien") is the four voice actors reading
the same 20 lines. To replace a take, put the new recording under
`src/pipeline/results/source-voices/human-readings/<voice>/` and run
`bun run humanness:human-clips --voices <voice> --upload --overwrite`. The
full recording, cutting and cleaning flow is in the RUNBOOK.

### Adding a source voice

A new source voice changes the benchmark for every model, so agree it with
Jordan before you start. It has not been done since launch, so expect
`bun test` to point out anything missed here.

1. Add the recordings to the Drive folder and to
   `src/pipeline/results/source-voices/originals/<name>/`.
2. Append `voice-<name>` to `SOURCE_VOICE_IDS` in `src/catalog/voices.ts` and
   `src/pipeline/voices.ts`, and `{ id: 'voice-<name>', name: '<Name>' }` to
   `SOURCE_VOICES` in `src/server/catalog.ts`. Append only: the existing
   order is frozen.
3. Clone the new voice on every provider with
   `bun run humanness:clone <provider> clone-samples` (voices already cloned
   are skipped), and commit the new ids in `src/pipeline/voices.ts`.
4. Generate its clips for every active model:
   `bun run humanness:clips <model-id> --voices <name> --upload`.
5. Every model serves every voice by default. Models we cannot generate for
   (the vendor-rendered ones, Canopy's Orpheus, and Human until the actor
   records the lines) need a `sourceVoices` list of the voices they have, so
   they are never paired on the new one.
6. Update the voice and variant pins in `src/catalog/catalog.test.ts`, and
   the "four voices" wording in `docs/METHODOLOGY.md` and the registry copy.

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
- `Unknown model "X"`: the `NEW_MODELS` row or registry entry is missing, or
  the id is misspelled. The error lists every known id.
- Provider-specific problems (rate limits, sample limits, unusual
  endpoints): the Provider quirks section of `src/pipeline/RUNBOOK.md` covers
  every provider already in the Index.
