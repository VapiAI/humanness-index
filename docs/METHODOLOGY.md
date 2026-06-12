# Methodology

The Humanness Index™ answers one question: how human does a text-to-speech
model sound? Nobody can fully define that feeling, so we do not try to
score it with a rubric. We play voices blind and let people judge.

## Blind, same-voice battles

Every battle is a head-to-head round: two models read the same customer
support prompt, and the listener picks whichever sounds more human (or
calls a tie). Model names are hidden until after the vote.

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

## Pure-vote Elo

A model's Humanness score derives purely from blind votes. There is no
editorial weighting, no panel, and no vendor input.

- Each (source voice, model) variant carries an Elo rating (initial 1200,
  K = 32). A vote updates both sides' ratings; ties pull ratings toward
  each other.
- A model's displayed rating is the mean of its variants' Elo ratings; its
  win/loss/tie counts are summed across variants.
- The displayed Humanness score normalizes the field's Elo ratings so the
  top model reads 100 and the bottom reads 0.
- Uncertainty is the standard error of an Elo estimate after n votes
  (160 divided by the square root of n). The "likely rank" range shows
  every rank consistent with each model's rating plus or minus its
  uncertainty band, so young models show wide ranges that narrow as votes
  accumulate.
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

## Measured-only latency

The latency column is never a vendor estimate. Every figure is the median
of 50 sequential live streaming trials run by `src/pipeline/ttfbBench.ts`
(a port of the original prototype's bench):

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

## Inclusion criterion: voice cloning

The Index only includes models that support voice cloning, because the
same-voice control requires cloning our licensed source voices on each
provider. A model without cloning support cannot be compared fairly and is
not listed. This is also why pull requests cannot add models end to end:
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
