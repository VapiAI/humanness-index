/**
 * Speechify (SpeechifyAI Build) transport — bench-only, like xai's.
 *
 * The arena's Simba 3.2 clips were vendor-rendered and are hash-frozen, and
 * cloning on simba-3.2 needs manual Speechify approval per voice, so there is
 * no `synthesize`/`createClone` here: the only thing this pipeline needs from
 * Speechify is a TTFB number.
 *
 * Shape per the public docs (docs.speechify.ai/build/api-reference/v1/audio/
 * stream + build/guides/text-to-speech/streaming, read 2026-07-30):
 *  - POST https://api.speechify.ai/v1/audio/stream, `Authorization: Bearer`,
 *    body `{ input, voice_id, model }`.
 *  - The `Accept` header is REQUIRED and picks the container. We send
 *    `audio/pcm` (returned as `audio/L16`, 16-bit LE, 24 kHz mono): the bench
 *    convention across the field is each provider's lowest-latency streaming
 *    mode, which is raw PCM for Cartesia, ElevenLabs' realtime WS, Inworld
 *    (LINEAR16), Neuphonic, xAI, and Smallest.ai (WAV). MP3 here would
 *    handicap Simba against them, and it also puts an ID3 tag ahead of the
 *    first audio frame.
 *  - Response is raw audio bytes over chunked transfer (no JSON envelope), so
 *    the first non-empty chunk is first audio — anyBytesMarker. With PCM
 *    there is no container header, so that first byte is a real sample.
 *  - `loudness_normalization` is left off (its default): the docs call out
 *    that enabling it adds latency.
 *
 * UNVERIFIED LIVE: written against the docs with no Speechify key on the
 * bench machine. Confirm the first run's numbers look sane (and that the
 * curated allow-list voice below is still registered) before landing a
 * median in the registry.
 */
import { requireEnv } from '../env';
import { anyBytesMarker, BENCH_TEXT, httpStreamTrial } from './http';
import type { ProviderTransport, TtfbPlan } from './types';

const API = 'https://api.speechify.ai';

/**
 * simba-3.2 serves a curated voice allow list (beatrice_32, dominic_32,
 * edmund_32, geffen_32, harper_32, hugh_32, imogen_32, wyatt_32); the arena's
 * cloned voices are not on it. geffen_32 is the docs' own streaming example.
 */
const BENCH_VOICE = 'geffen_32';

const apiKey = (): string => requireEnv('SPEECHIFY_API_KEY');

export const speechify: ProviderTransport = {
  providerId: 'speechify',
  apiKeyEnv: 'SPEECHIFY_API_KEY',

  ttfbPlanFor: (vendorModelId): TtfbPlan => ({
    transport: 'http-stream (chunked)',
    notes: `first-chunk timing on /v1/audio/stream (raw PCM 16-bit LE 24 kHz, voice ${BENCH_VOICE})`,
    trial: () =>
      httpStreamTrial(
        `${API}/v1/audio/stream`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey()}`,
            'content-type': 'application/json',
            accept: 'audio/pcm',
          },
          body: JSON.stringify({
            input: BENCH_TEXT,
            voice_id: BENCH_VOICE,
            model: vendorModelId,
          }),
        },
        anyBytesMarker,
      ),
  }),
};
