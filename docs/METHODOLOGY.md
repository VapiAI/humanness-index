# Methodology

The Humanness Index™ answers one question: in a live conversation, can a
text-to-speech voice pass as a real person? Nobody can fully define that
feeling, so we do not try to score it with a rubric. We play voices blind,
let people judge, and set the bar at a real human (a Humanness of 100).

## Blind, same-voice battles

Every battle is a head-to-head round: two models read the same customer
support prompt, and the listener picks whichever sounds more human (or
calls a tie). Model names are hidden until after the vote.

The blind is enforced server-side. The battle payload carries no identities,
only the two clips and a signed token; the identities, each side's Elo change,
and whether the pick matched the crowd are returned only by the vote, and the
client builds the reveal from that response. "Listen" samples elsewhere on the
page pass the battle token so the server never serves a battling model on the
battle's voice, which keeps a labeled clip from unmasking a blind card.

The critical control is the voice itself. Both sides of every battle speak
with the same cloned source voice. We licensed master recordings from four
voice talents (Clara, Emma, Godfrey, and Nelliot) and cloned each voice on
every provider, so a battle compares the models, not the voices. Without
this control, a pleasant voice would beat a better model every time.

The prompts are 20 fixed customer-support utterances with natural
disfluencies (mid-sentence corrections, "um"s, trailing pauses). They are
frozen: every model reads exactly the same material, and the prompt text
feeds the audio content hashes that address the ~1,700 pre-generated clips.

What listeners say gives a synthetic voice away, and what we listen for:

- Expressiveness: stressing the right words, sounding like it means what
  it says instead of reading text aloud.
- Tone and prosody: the intonation, rhythm, and melody of speech.
- Artifacts: the little human sounds (breaths, stutters, natural pauses).
  A voice with none of them sounds too clean to be real.
- Latency: how quickly a voice starts to respond. This is measured
  separately (below), not judged by ear.

## Pure-vote ratings (Bradley–Terry)

A model's Humanness score derives purely from blind votes. There is no
editorial weighting, no panel, and no vendor input.

- The published rating is a **Bradley–Terry** maximum-likelihood fit over the
  entire blind-vote history, shown on a familiar Elo-like scale. Unlike a
  running Elo (a fixed-step update that never fully settles), a Bradley–Terry
  fit is an all-history estimate: it converges as votes accumulate and it
  weights wins by how strong the opponent was. Standings are recomputed from
  the full, immutable vote log, so they don't swing with each new vote.
- The displayed Humanness score normalizes the field's ratings so the anchor
  reads 100 and the lowest model reads 0, leaving the top open so a voice that
  out-rates the baseline can score above 100. With the Human baseline present
  it is the anchor (see below); without a baseline, the top model reads 100.
- The "likely rank" range is a **bootstrap**: the votes are resampled many
  times and the fit re-run, and the column shows the span of ranks a model
  plausibly holds (95% of resamples). A tight cluster of near-equal models
  reads as a range; it narrows as votes accumulate.
- A lightweight running Elo is still kept internally to pair blind battles
  (close-matchup and coverage weighting); it never appears in the standings.
- Battle pairing is convergence-weighted: under-voted models are forced
  into coverage first, then pairs are weighted toward maximum information
  gain (uncertainty reduction, close matchups, unresolved rank overlaps,
  per-voice balance). Sides are shuffled so position never encodes
  identity.

Vote integrity: every battle issues a single-use HMAC-signed token, votes
are rate-limited per IP, and a Turnstile challenge gates every Nth vote.
The store is event-sourced; standings are a deterministic fold of the vote
events over the production seed, so anyone can audit the math in
`src/server/elo.ts` and `src/server/store.ts`.

## The Human baseline

The Index includes one real-human reference, shown as provider "Human", model
"Homo Sapien". It is not a TTS model: the same four voice talents who recorded
the source voices also read the same 20 lines, and those recordings battle the
cloned TTS of the same voice head to head ("which voice sounds more human?").
The human takes run through the same human-clip pipeline before they enter the
arena (segmented per line, de-tapped, denoised, and loudness-matched), so a
battle turns on the voice itself, not on recording quality.

- It anchors the scale at 100, the human reference point the field is measured
  against, not a perfect-score ceiling. The human is pinned to a Humanness of
  100 and every model is normalized against it, so a score reads as a share of
  the human mark. Its anchor Elo is seeded above the field so the top TTS lands
  a clear gap below 100, but the top of the scale is open: because the Elo that
  votes move is uncapped, a model that listeners ever judge more human than the
  real person out-rates it and scores above 100 (super-human), while the human
  stays pinned at 100 as the reference.
- It is a reference, not a competitor: a distinct pinned top "baseline" row,
  excluded from the model and provider counts and from latency plots, with no
  latency or price.
- It only battles on the source voices it has actually recorded (Clara and
  Nelliot today). This is the general `sourceVoices` rule: any model is paired
  only on the voices it has clips for.

## Measured-only latency

Humanness can't come at the cost of latency: a voice that lags breaks the
conversation. So the distribution chart pairs Humanness with measured
responsiveness, and the best models sit top-right, as human as a person and
near-instant.

The latency column is never a vendor estimate. Every figure is the median
of 50 sequential live streaming trials run by `src/pipeline/ttfbBench.ts`:

- 2 warm-up trials discarded, 50 measured trials per model.
- Sequential within a provider (concurrency inflates TTFB); providers run
  in parallel.
- t0 at synthesis-request send on a pre-established connection (explicit
  connect for WebSocket transports; keep-alive absorbed by warm-ups for
  HTTP); t1 at the first audio chunk.
- Trials include network round-trip time from the benchmark machine, so
  the relative ordering across models is the robust signal, not the
  absolute milliseconds.

Models with no publicly reachable API to measure show a dash and are
excluded from latency plots. A small number of figures are team-reported
measurements (same protocol, run where the pipeline had no credentials);
they are marked as such in the data with reduced confidence.

## Independence from the Vapi product

The Index is an open benchmark built by Vapi, but it is independent of the
Vapi product. A model appearing on the Index does not mean it is available
in Vapi, and whether a model is available in Vapi plays no part in whether
it is listed or how it scores. Inclusion is governed only by the voice
cloning criterion below.

## Inclusion criterion: voice cloning

A model can sound human on its own demo voice and robotic on yours, so
comparing vendors' hand-picked clips is apples to oranges. The Index only
includes models that support voice cloning, because the same-voice control
requires cloning our licensed source voices on each provider. A model without
cloning support cannot be compared fairly and is not listed. This is also why pull requests cannot add models end to end:
clip generation requires the licensed source voices, which stay with the
maintainers (see `docs/ADDING_A_MODEL.md`).

Models can also be:

- Retired: rotated out of battle sampling and the index table while their
  detail pages stay live (an earned URL never 404s).
- Unlisted: tested before a provider's public announcement, excluded from
  every public surface until launch.

## Provenance

Every claimed fact on the site (pricing, language counts, release dates)
carries a source URL and an as-of date in `src/catalog/`, validated by the
test suite. Standings data published by the API is licensed CC BY 4.0;
see TRADEMARKS.md for the full content licensing split.
