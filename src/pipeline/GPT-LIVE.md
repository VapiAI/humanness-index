# GPT-Live 1: pending eligibility

Research checked 2026-10-27. Vendor model `gpt-live-1`; pending pipeline id
and slug `openai-gpt-live-1`, provider `openai`, arena API id `gpt-live-1`.
These identities become frozen once arena clips exist.

OpenAI documents recording-based custom voices for this model. That satisfies
the documented cloning capability, but recording-voice access and fixed-script
fidelity remain unverified. A project key was provisioned on 2026-10-27:
authenticated model listing includes `gpt-live-1`, and a silent WebSocket session
successfully returned `session.started` with that exact model, followed by
`session.closed` with `close_requested` and zero usage seconds. No speech was
requested or used from that connectivity check.

Both documented consent read routes returned HTTP 404; the consent-list body
said `Endpoint not found.` These responses do not distinguish entitlement,
key scopes or route availability and do not establish that consent creation
would fail. Stop repeating the failed reads; confirm the recording-based voice
surface before uploading licensed audio. Request IDs and raw diagnostic
summaries are retained locally under gitignored `results/openai/`.

There is no active catalog entry, score, published latency,
batch synthesis implementation, or uploaded GPT-Live clip in this change.
Vapi product integration and multilingual/full duplex evaluation are outside
this benchmark's scope.

## Access and recordings

Use a project-scoped `OPENAI_API_KEY` approved for GPT-Live and recording-based
custom voice creation. Configure it securely in the Vercel Humanness Index
project's Development environment or in gitignored `src/pipeline/.env`; never
paste it into chat. Set `OPENAI_PROJECT_ID` to the actual key's project.
Browser membership and Codex login are not API credentials.

Required API surfaces:

| Operation | API |
| --- | --- |
| Read current consent phrases | `GET /v1/audio/consent_phrases`, `api.voices.read` |
| Recover existing consents | `GET /v1/audio/voice_consents`, `api.voices.read` |
| Upload actor consent | `POST /v1/audio/voice_consents`, `api.voices.write` |
| Create recording clone | `POST /v1/audio/voices`, `api.voices.write`, recording-based custom voice entitlement |
| Render speech | `wss://api.openai.com/v1/live/sessions`, GPT-Live model access plus custom voice use (`api.voices.read`) |

All requests must use the same project. Successful reads do not establish write
or model access. A 404 may mean missing access, revoked/deleted voice, or a
different project's consent. Stop persistent authorization failures and record
the endpoint/status; do not create replacement voices to work around access.
Voice creation from recordings is limited to eligible customers and is not
compatible with Zero Data Retention; do not change organization data controls
to bypass an error. Check existing agreements/enablement if needed.

The four actors are Clara, Emma, Godfrey and Nelliot. Reuse trusted existing
recording voices/consents if the project already has them. Verify the mapping
to the actual actor and same-project provenance; a display name alone is not
proof. Existing external-provider clone IDs are incompatible with OpenAI.

If consent objects do not exist, each actual actor must separately record the
current English consent phrase, exactly and with no other speech:

> I am the owner of this voice and I consent to OpenAI using this voice to create a synthetic voice model.

Do not synthesize consent, splice it from source audio, or treat the general
source license as the required consent recording. Check the current phrase
endpoint before arranging recording. The reference sample must be that same
person, with at least five seconds of speech and 15 transcribed tokens;
OpenAI recommends 10–60 seconds with several complete sentences. Samples must
be at most 60 seconds; each upload is limited to 10 MiB. Supported recording
types: MPEG, WAV, OGG, AAC, FLAC, WebM and MP4. Use a supported base MIME type
(for example `audio/webm`, without `;codecs=opus`). The service extracts the
reference transcript and validates the recordings. Listen and locally check
duration/transcript before uploading; this transport's byte/type checks alone
do not establish those audio requirements.

## Commands and receipts

```sh
bun run humanness:openai inspect
bun run humanness:openai upload-consent voice-clara /private/path/clara-consent.wav
# Repeat upload-consent for the other actual actors, once their recordings exist.
bun run humanness:clone openai /private/path/approved-reference-samples
bun run humanness:openai render voice-clara clip-01
```

`inspect` performs sequential read requests only and stops on the first
failure. Inspect existing objects before creating any. The consent upload
checks the phrases endpoint, then uploads the supplied actor recording; it
cannot independently establish that the actor read the exact phrase.

The sample directory needs one intended file per source voice, as described
in the main RUNBOOK. Consent audio belongs in a separate directory.
Consent and clone creation receipts are saved immediately in gitignored
`results/openai/<OPENAI_PROJECT_ID>/voices.json`. They bind each source voice
to consent ID, recording SHA-256, clone ID and reference SHA-256. Identical
inputs reuse existing receipts; changed inputs stop for review. Normal clone
CLI persistence also writes `voices.local.json`. Do not copy receipts across
projects. For trusted pre-existing consents, recover the returned ID and
record it in this project-bound file only after verifying its actor mapping;
never invent an ID. The file shape is:

```json
{
  "projectId": "proj_example",
  "voices": {
    "voice-clara": { "consentId": "cons_example" }
  }
}
```

The generic clone CLI continues to other voices on errors. If an access probe
fails, stop rather than invoking that CLI. A network timeout after creation
may leave an object without a local receipt: inspect the service before
retrying, since POST creation is not guaranteed idempotent.

## Rendering protocol and acceptance gate

The current docs describe a conversational model, not a guaranteed text-to-
speech endpoint. `response.create` drives delegated backend work; it is not a
Live speech-rendering trigger. `session.commentary.append` may paraphrase.
The instructions-based disclosure route also requires checking actual audio.
OpenAI recommends a verified recording for guaranteed wording; externally
rendered TTS must never be presented as GPT-Live output on the Index.

The bounded probe uses:

1. Fresh WebSocket, `gpt-live-1`, custom voice object `{ "id": "voice_..." }`,
   client delegation (no Responses backend), `store: false`, mono PCM16 24 kHz.
2. Wait for `session.started`; reject a resolved model/voice mismatch. Startup
   instructions request silence until the script trigger.
3. Send continuous silent PCM input, paced in 20 ms frames. Immediately send
   one `session.instructions.append` requesting the unmodified frozen prompt
   exactly, preserving fillers/repeats, then silence. No corrective prompts,
   external speech, auto-retries, or manual edits.
4. Capture every nonempty audio delta and transcript fragment with timestamps.
   Reject pre-trigger output, malformed PCM, changed/additional transcript
   words, silence, runaway audio, or provider errors. Empty deltas are not audio.
5. Request graceful close after three seconds with no detected speech and no
   new transcript when the word sequence matches. This is a heuristic: Live
   has no audio-completion event. Otherwise close after a 60-second deadline.
   Keep receiving through `session.closed` (15-second finalization timeout),
   including late words/audio/errors, and retain final usage and close reason.

Every attempted render gets a unique gitignored directory under
`results/openai/probes/`, containing `output.pcm` and `report.json`. A failed
attempt remains visible and is not silently retried. A matching Live transcript
is only an initial check: independently transcribe the actual PCM and listen
for missing text, filler removal, wrong voice, truncation and non-speech.
Punctuation/case normalization never removes fillers or repeated words.

Convert a probe for listening or independent ASR without modifying its speech:

```sh
ffmpeg -f s16le -ar 24000 -ac 1 -i /private/path/output.pcm /private/path/output.wav
```

Begin with Clara clips 01–03, one explicit command per attempt. Stop repeated
malformed output or access failures. If viable, inspect samples spanning all
four voices before any full matrix. Record all settings, failures and changes
to this protocol. Only after a reproducible controlled route is demonstrated
should a batch transport be added. The complete 80 clips still need independent
transcription, duration/listening QA, canonical normalization/upload, and hosted
verification before any active catalog entry. Do not manufacture scores.

## Latency compatibility remains unresolved

The probe records connection/startup time separately from exploratory
`session.instructions.append` send to first nonempty audio-delta arrival, on
an established session. Silent initial output may make that number useless;
listen and inspect PCM rather than assuming it is audible first speech.
Context injection is asynchronous and an append acknowledgment confirms
neither speech nor playback. This is not yet equivalent to the Index's
synthesis-request-to-first-audio protocol and is never written to
`ttfb_results_50trial.json` or a catalog latency field. Startup time, turn-taking
latency and full duplex performance are not synthesis TTFB.

The OpenAI transport returns a model-level unmeasurable explanation pending
protocol validation; it does not blacklist the whole provider. If no comparable
protocol can be established but all speech controls pass, list latency as null.
If a comparable protocol is established, run two discarded warmups and 50
sequential trials, preserve all failures/raw measurements, use the same fixed
12-word benchmark text, and report actual voice/settings/network context.

## Sources

- [Exact model identity and endpoint](https://developers.openai.com/api/docs/models/gpt-live-1)
- [Recording creation, consent, limits, project access and custom voice use](https://developers.openai.com/api/docs/guides/custom-voices#use-a-voice-from-a-recording-with-gpt-live)
- [WebSocket session lifecycle, PCM, pacing and audio events](https://developers.openai.com/api/docs/guides/voice-websockets?api=live)
- [Context timing, exact-wording limitations and graceful finalization](https://developers.openai.com/api/docs/guides/live-conversations)
- [Consent listing API](https://developers.openai.com/api/reference/resources/audio/subresources/voice_consents/methods/list)
