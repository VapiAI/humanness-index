/**
 * Cartesia transport. Synthesis over /tts/bytes (mp3 44.1 kHz / 128 kbps);
 * Pro Voice Clone creation over the datasets + fine-tunes endpoints per
 * https://docs.cartesia.ai/build-with-cartesia/capability-guides/clone-voices-pro;
 * TTFB over the realtime WS, same 50-trial protocol.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { requireEnv } from '../env';
import {
  BENCH_TEXT,
  postFormNoContent,
  postJsonForBytes,
  requestJson,
  wsTtfbTrial,
} from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const API = 'https://api.cartesia.ai';

/**
 * One version pin for every Cartesia call, HTTP and WS. Cartesia dates its
 * API versions and serves the request shape matching the pin, so synthesis
 * and the TTFB bench have to send the same one or they exercise different
 * contracts. 2026-08-14 is the current published version.
 * https://docs.cartesia.ai/use-the-api/api-conventions
 */
const VERSION = '2026-08-14';

/**
 * Stock library voice for the TTFB bench, from Cartesia's realtime TTS
 * quickstart. Every other provider is benched on a stock voice; benching
 * Cartesia on an arena clone put a cloned-voice lookup in the measured path
 * that no other row on the table pays.
 */
const BENCH_VOICE = 'f786b574-daa5-4673-aa0c-cbe3e8534c02';

/** The four licensed source voices are English (see pipeline/voices.ts). */
const VOICE_LANGUAGE = 'en';

/**
 * Base model for Pro Voice Clone fine-tunes, and the only value the
 * CreateFineTuneRequest model_id enum accepts today. Cartesia forward-fills
 * a PVC onto newer models as they ship, so a clone trained here also serves
 * sonic-3.6 without retraining.
 */
const PVC_BASE_MODEL = 'sonic-3.5-2026-05-04';

const POLL_INTERVAL_MS = 30_000;
/** Cartesia documents PVC training as taking up to 3 hours. */
const TRAINING_TIMEOUT_MS = 4 * 60 * 60 * 1000;

/** Bearer is the documented scheme; x-api-key is the pre-2026 form. */
const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${requireEnv('CARTESIA_API_KEY')}`,
  'Cartesia-Version': VERSION,
});

type Dataset = { id: string };
type FineTuneStatus = 'created' | 'training' | 'completed' | 'failed';
type FineTune = {
  id: string;
  status: FineTuneStatus;
  user_errors?: Array<{ code: string; message: string }>;
};
type FineTuneVoices = { data: Array<{ id: string }> };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const cartesia: ProviderTransport = {
  providerId: 'cartesia',
  apiKeyEnv: 'CARTESIA_API_KEY',

  synthesize: async ({ vendorModelId, providerVoiceId, text }) => ({
    bytes: await postJsonForBytes(
      `${API}/tts/bytes`,
      { ...headers(), accept: 'audio/mpeg' },
      {
        model_id: vendorModelId,
        transcript: text,
        voice: { mode: 'id', id: providerVoiceId },
        // Without an explicit language Cartesia infers one from the
        // transcript, so a clip could be read with the wrong phonology on a
        // short or ambiguous line. Every arena prompt is English.
        language: VOICE_LANGUAGE,
        output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
      },
      'cartesia',
    ),
    format: 'mp3' as const,
  }),

  /**
   * Pro Voice Clone, the four-step flow from the capability guide: dataset,
   * files, fine-tune, then the voice the fine-tune produced. The previous
   * implementation called /voices/clone, which is an Instant Voice Clone off
   * a single ~10s clip and a materially different (lower fidelity) product
   * than the PVCs the arena's Cartesia voices actually are.
   */
  createClone: async ({ displayName, sampleFiles }) => {
    if (sampleFiles.length === 0) {
      throw new TransportError('cartesia PVC needs at least one sample file');
    }
    const description = `Humanness Index source voice ${displayName}`;

    const dataset = await requestJson<Dataset>(
      'POST',
      `${API}/datasets`,
      headers(),
      { name: displayName, description },
      'cartesia datasets/create',
    );

    // Every sample, not just the first: a PVC trains on the whole dataset and
    // needs 30+ minutes of audio (2 hours or more gives the best results).
    for (const file of sampleFiles) {
      const form = new FormData();
      form.append(
        'file',
        new Blob([readFileSync(file)], { type: 'audio/wav' }),
        basename(file),
      );
      form.append('purpose', 'fine_tune');
      await postFormNoContent(
        `${API}/datasets/${dataset.id}/files`,
        headers(),
        form,
        `cartesia datasets/upload-file ${basename(file)}`,
      );
    }

    const started = await requestJson<FineTune>(
      'POST',
      `${API}/fine-tunes`,
      headers(),
      {
        name: displayName,
        description,
        language: VOICE_LANGUAGE,
        model_id: PVC_BASE_MODEL,
        dataset: dataset.id,
      },
      'cartesia fine-tunes/create',
    );

    // POST /fine-tunes returns a fine-tune, not a voice. The voice only
    // exists once training completes, so poll rather than assume.
    const deadline = Date.now() + TRAINING_TIMEOUT_MS;
    for (;;) {
      const current = await requestJson<FineTune>(
        'GET',
        `${API}/fine-tunes/${started.id}`,
        headers(),
        undefined,
        'cartesia fine-tunes/get',
      );
      if (current.status === 'completed') break;
      if (current.status === 'failed') {
        const detail = (current.user_errors ?? [])
          .map((error) => `${error.code}: ${error.message}`)
          .join('; ');
        throw new TransportError(
          `cartesia fine-tune ${started.id} failed${detail ? ` (${detail})` : ''}`,
        );
      }
      if (Date.now() > deadline) {
        throw new TransportError(
          `cartesia fine-tune ${started.id} still ${current.status} after ` +
            `${TRAINING_TIMEOUT_MS / 3_600_000}h. Training was started, so re-attach ` +
            `with GET /fine-tunes/${started.id} rather than starting a second one ` +
            `(PVC fine-tunes consume a plan slot).`,
        );
      }
      console.log(
        `  cartesia fine-tune ${started.id}: ${current.status} (polling every ${POLL_INTERVAL_MS / 1000}s)`,
      );
      await sleep(POLL_INTERVAL_MS);
    }

    const voices = await requestJson<FineTuneVoices>(
      'GET',
      `${API}/fine-tunes/${started.id}/voices`,
      headers(),
      undefined,
      'cartesia fine-tunes/list-voices',
    );
    const voiceId = voices.data[0]?.id;
    if (!voiceId) {
      throw new TransportError(
        `cartesia fine-tune ${started.id} completed but produced no voices`,
      );
    }
    return voiceId;
  },

  ttfbPlanFor: (vendorModelId): TtfbPlan => ({
    transport: 'websocket',
    trial: () =>
      wsTtfbTrial({
        url: 'wss://api.cartesia.ai/tts/websocket',
        headers: headers(),
        framesFor: () => [
          JSON.stringify({
            model_id: vendorModelId,
            transcript: BENCH_TEXT,
            voice: { mode: 'id', id: BENCH_VOICE },
            output_format: {
              container: 'raw',
              encoding: 'pcm_s16le',
              sample_rate: 24000,
            },
            context_id: `bench-${Date.now()}`,
            continue: false,
            language: VOICE_LANGUAGE,
          }),
        ],
        jsonHasAudio: (payload) => Boolean(payload.data),
        // Cartesia-Version >= 2026-03-01 returns structured errors
        // (error_code / title / message); keep the legacy shapes too so the
        // bench still reports usefully if the pin is rolled back.
        jsonError: (payload) =>
          payload.type === 'error' || payload.error
            ? JSON.stringify(payload)
            : null,
      }),
  }),
};
