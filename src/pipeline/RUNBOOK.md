# Humanness Index expansion pipeline: RUNBOOK

Everything clip-related lives in this folder and runs through package.json
scripts (bun). The original private prototype is reference-only: the
transports here port its per-provider adapter shapes and its 50-trial TTFB
methodology.

```
pipeline/
  .env                # secrets (gitignored); see .env.example
  voices.local.json   # clone ids registered by humanness:clone (gitignored)
  results/            # clips, manifests, benchmark JSON (gitignored)
  transports/         # per-provider synthesis + clone + TTFB request shapes
  env.ts              # pipeline/.env loader + requireEnv
  lib.ts              # frozen hash scheme, clip URLs, arg/stat helpers
  prompts.ts          # the 20 arena prompts (verbatim copy, sync note inside)
  voices.ts           # provider -> source voice -> cloned-voice-id registry
  models.ts           # registry-backed model resolution (+ pre-registration table)
  generateClips.ts    # humanness:clips  -- 80 clips per model, hash-named
  uploadClips.ts      # blob upload, skip-if-exists
  cloneVoices.ts      # humanness:clone -- register the 4 source voices
  ttfbBench.ts        # humanness:ttfb  -- 50-trial TTFB port
  verifyClips.ts      # humanness:verify-clips -- registry-derived HEAD check
```

## The five frozen steps for ANY new model

Sequencing is strict: **clips uploaded + HEAD-verified BEFORE the registry
change lands**. The moment the registry includes a model, battles can serve
it.

1. **Clone voices** (once per provider): all 4 licensed source voices
   (Clara, Emma, Godfrey, Nelliot) must exist as clones on the provider.

   ```sh
   bun run humanness:clone <provider> <source-clips-dir>   # api cloning
   bun run humanness:clone <provider> --list               # inspect/verify
   bun run humanness:clone <provider> --record voice-clara=<id> ...  # UI-created clones
   ```

   `<source-clips-dir>`: `clara.wav`/`emma.wav`/... or `clara/*.wav` subfolders.

2. **Generate + upload the 80 clips** (4 voices x 20 prompts, MP3, named
   `sha256("{variantId}|{promptId}|settings-v3")[:32].mp3` with
   `variantId = variant:{voiceId}:{providerId}:{arenaApiId}`):

   ```sh
   bun run humanness:clips <model-id> --upload
   ```

   Exit 0 means every expected hash HEAD-resolves on the audio origin.
   Models not yet in the registry resolve via the pre-registration table in
   `pipeline/models.ts` (add a row there first: id, providerId, arenaApiId,
   all FROZEN FOREVER once clips are hashed, plus the vendor model id).

3. **Register** in `catalog/models.ts` following the header checklist
   (entry + provider if new + mark file; sourced stats; at least 2 copy
   blocks and 2 FAQs, no em dashes; `sample.fallbackClip` pinned via
   `clip()` to one of the just-uploaded hashes; bump the pinned counts in
   `catalog.test.ts`). Then:

   ```sh
   bun run check-types && bun test
   bun run humanness:verify-clips <model-id>      # registry-derived HEAD pass
   ```

4. **Benchmark TTFB** (50 trials, 2 discarded warm-ups, sequential per
   provider, pre-established connection, first-audio-chunk timing):

   ```sh
   bun run humanness:ttfb <model-id ...>          # default: all benchable models
   ```

   Write the median into the model's registry entry as
   `pipelineTtfb(<median>)` (provenance:
   `src/pipeline/results/ttfb_results_50trial.json`).
   Latency is measured-only, never a vendor estimate; leave
   `latencyMs: null` if the model has no reachable endpoint.

5. **Browser check** on the dev server: the index table shows the model,
   battles can pair it, its Listen sample plays, and `/models/<slug>`
   renders.

New models enter at Elo 1200 on their first live votes (no seed-standings
row; `mergeStandings` handles unseeded models and the table includes them on
the first live fetch).

## Status: the remaining expansion models

(LMNT was cut from the expansion on 2026-06-11. Its dormant, never-run-live
transport and the LMNT_API_KEY slot in .env.example were deleted in the
2026-06-12 cleanup. Should that change: LMNT clones voices from a 5-10 s
sample via its Voices API on all paid tiers, and synthesizes over WS/HTTP
per docs.lmnt.com; model ids were blizzard-2.0 and aurora.)

| Provider | Models | Blocker | Next action |
| --- | --- | --- | --- |
| Inworld | TTS-1, TTS-1.5 Mini | TWO keys tried (2026-06-11 and 2026-06-12): both authenticate for TTS synthesis (`GET /tts/v1/voices` 200) but lack the `voices` write scope. `POST /voices/v1/voices:clone` and `GET /voices/v1/voices` return 403 `{"code":7,"message":"api key does not have required scopes"}` on every attempt. The arena's original clones (`inworld-clara` etc.) live on a workspace neither key can see (synthesis with those ids 404s; voice listing shows 148 stock voices, 0 custom). Per-voice 15 s samples stay staged in `results/source-voices/inworld/` | Get an Inworld key with `voices` rw scope from platform.inworld.ai (or clone the 4 voices in the Portal UI), persist ids via `humanness:clone inworld --record voice-clara=<id> ...`, then `humanness:clips inworld-tts-1 --upload` + `inworld-tts-1-5-mini` (rows already in pipeline/models.ts), register, bench |
| Smallest.ai | Lightning v3.1 | **REGISTERED + MEASURED (2026-06-12)**: in the catalog as `smallestai-lightning-v31` + `smallestai` ProviderEntry; all 81 hosted clips HEAD-verify; 50-trial TTFB median 420 ms (`pipelineTtfb(420)`). Transport uses the unified `POST /waves/v1/tts` with body `model: lightning_v3.1` (per-model get_speech routes retire 2026-07-14); clone endpoint `POST /waves/v1/voice-cloning` (5-15 s sample, max 5 MB). clara x clip-05 DEFECT RESOLVED IN PLACE: the model deterministically reads the prompt but truncates the final question ("...have the wrong-") and then screams for ~87 s (reproduced 4x incl. one regen on 2026-06-12); the hosted clip was trimmed at the 13.0 s silence boundary (now 13.2 s, Scribe-verified clean speech, same hash path) and the registry pins emma x clip-12 as fallbackClip, NEVER clara/clip-05. BENCH QUIRKS (2026-06-12): Bun 1.0.3 fetch wedges the event loop (100% CPU, 0 sockets) after ~30-40 streaming trials in one process, so run the bench in `--trials 10` slices in fresh processes and merge (see results/merge-ttfb-20260612.ts); killing a wedged run mid-stream tripped a ~15-min server-side throttle where `/waves/v1/tts` accepts connections but never responds while other routes stay 200. Wedge REPRODUCED later the same day: a redundant single-process 50-trial retry stalled at 30/50 (killed; the bench only writes the artifact at the end, so nothing was lost). The slice guidance stands | None: done (median 420 ms landed via the 5 x 10-trial slices) |
| Neuphonic | neu_hq | **REGISTERED + MEASURED (2026-06-12)**: in the catalog as `neuphonic-neu-hq` + `neuphonic` ProviderEntry; all 81 hosted clips HEAD-verify; 50-trial TTFB median 276 ms (`pipelineTtfb(276)`). The public API **ignores `model`** everywhere (bogus values return audio; identical TTFB distributions; both current SDKs dropped the field): one served pool, so the entry represents that pool under the neu_hq branding and the model page says so. Clone quirks: endpoint is `POST /voices?voice_name=...` (multipart `voice_file`); sample must be **3-10 s** (docs say at least 6 s, and the upper bound is wrong); some WAVs 500 instantly, re-encoding the same audio as MP3 succeeds. Bench quirk: an EMPTY `voice_id` draws an in-stream 500 error event, so omit the field for the default voice (fixed in transports/neuphonic.ts 2026-06-12) | None: done |
| Neuphonic | neu_fast | **PARKED, hosted but unregistered (2026-06-12)**: 80 clips uploaded + HEAD-verified under arenaApiId `neu-fast` (FROZEN), but the API ignores the model param, so these clips came from the SAME served pool as neu_hq's; registering both would put two rows on one system (methodology integrity wins). The request body did send `model: neu_fast`, so the clips become retroactively correct if Neuphonic exposes true per-model selection | Revisit if Neuphonic exposes true per-model selection; the pre-registration row stays in pipeline/models.ts |
| Hume | Octave, Octave 2 | Clone creation is **Platform-UI only** (the API uses clones but cannot create them), manual console work | `bun run humanness:clone hume` prints the console steps; record ids with `--record`; then steps 2-5. Octave 2 voices are not backward compatible with Octave 1, so clone on the right model family |
| Sesame | CSM-1B | **Decision needed**: the hosted deployment's clone path expects source samples staged in its own private storage, which this pipeline cannot reach | Decide: get upload access / self-host CSM-1B cloning / drop Sesame. Transport synthesis works against the SESAME_URL host; `createClone` intentionally throws with this note |

Source clips for cloning: the licensed master recordings live at
`pipeline/results/source-voices/originals/{clara,emma,godfrey,nelliot}/`
(32 files). Use these for all future cloning. (The 2026-06-11 MiniMax
re-clones used equivalent samples recovered from the ElevenLabs PVC voices
via `GET /v1/voices/{id}/samples/{sample_id}/audio` before the masters were
dropped in; the originals supersede them.)

## Provider quirks worth knowing

- **ElevenLabs**: synthesis pins the arena's settings-v3 voice settings
  (stability 0.35 / similarity 0.95 / style 0.5 / speaker boost) at
  mp3_44100_128. Keep these or the new clips will not match the family
  sound. Multilingual v2 and v3 are rejected by the realtime stream-input
  WS; their TTFB runs on the chunked HTTP /stream endpoint.
- **MiniMax**: hosted clips are mp3 32 kHz/128 kbps mono (`audio_setting`);
  `voice_id`s are caller-chosen at clone time. The arena's are
  `minimax-clara|emma|godfrey|nelliot`. `MINIMAX_GROUP_ID` is appended as
  `?GroupId=` where present.
- **Inworld**: `INWORLD_API_KEY` is a base64 **Basic** token. Hosted clips
  are MP3 48 kHz. Registry `arenaApiId`s are frozen without dots
  (`tts-1-5-mini`); the vendor API wants `inworld-tts-1.5-mini`, and the
  mapping lives in `pipeline/models.ts` (VENDOR_MODEL_ID_OVERRIDES handles
  the already-registered ids).
- **xAI (2026-06-12)**: both Grok configs speak the SAME realtime WebSocket
  `wss://api.x.ai/v1/tts`; per the team, the two Index models differ only by
  the `optimize_streaming_latency` query param: enabled for Grok TTS
  (Streaming) (`xai-streaming`), disabled for plain Grok TTS
  (`xai-xai-tts`). `transports/xai.ts` benches each with its own flag state
  (protocol per xAI's public realtime TTS docs: params in the URL query,
  `Authorization: Bearer`, send `{"type":"text.delta","delta":...}` +
  `{"type":"text.done"}`, binary PCM frames back; built-in voice `eve`,
  pcm 24 kHz, 30 s timeout, one in-trial retry). 2026-06-12 runs, 50/50
  clean single-process trials each: flag ON median 285 ms
  (`pipelineTtfb(285)`), flag OFF median 460 ms (`pipelineTtfb(460)`), a
  clean ~175 ms read on what the flag buys. WS trials do not hit the Bun
  fetch wedge that forces HTTP-stream benches into slices. HTTP side note:
  the documented batch route `POST /v1/tts` works with this key (200,
  audio/mpeg, single-probe first-byte ~463 ms); only the legacy
  `/v1/audio/speech` path 403s (re-probe: `results/probe-xai-http.ts`).
- **Blob store**: `audio/{hash}.mp3`, public access, `addRandomSuffix:
  false`. Uploads are idempotent (skip-if-exists); the token's store id must
  be the arena audio origin (bkvlbh5qphzaen1w...).

## TTFB results provenance

`humanness:ttfb` writes `results/ttfb_results_50trial.json` (gitignored,
like the original prototype's artifact) and OVERWRITES it per invocation,
so back it up before filtered runs and re-merge (precedent scripts:
`results/merge-ttfb-20260612.ts`, `results/merge-ttfb-20260612-xai.ts`).
That overwrite bit the 2026-06-12 session itself: the final filtered
xai-xai-tts run (median 460) replaced the just-merged artifact, so as of
2026-06-12 the artifact holds only that record and the rest live in the
dated backups beside it (`.backup-20260612` = the wave-1 three,
`.bak-20260612-pre-xai` = five records pre-xai, `.xai-only` =
xai-streaming). All seven pipeline-measured medians are in the registry as
`pipelineTtfb(...)`; re-merge from the backups (or re-run the bench) before
citing the artifact wholesale. June 2026 run context: local dev machine,
includes network RTT; relative ordering is the robust signal.
