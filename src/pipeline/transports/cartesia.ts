/**
 * Cartesia transport. Synthesis ported from the original prototype's
 * Cartesia adapter (tts/bytes, mp3 44.1 kHz /
 * 128 kbps); pro voice cloning per
 * https://docs.cartesia.ai/build-with-cartesia/capability-guides/clone-voices-pro;
 * TTFB over the realtime WS, same 50-trial protocol (stock voice).
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { requireEnv } from '../env';
import { BENCH_TEXT, postFormNoContent, postJsonForBytes, requestJson, wsTtfbTrial } from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const API = 'https://api.cartesia.ai';

/** Cartesia's current published API version, sent on every call. */
const VERSION = '2026-08-14';

/** Stock library voice, so the bench matches how other providers are measured. */
const BENCH_VOICE = 'f786b574-daa5-4673-aa0c-cbe3e8534c02';

/** The four licensed source voices are English (see pipeline/voices.ts). */
const VOICE_LANGUAGE = 'en';

/** Train against Sonic 3.5; PVCs forward-fill onto new models as they ship. */
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
type FineTune = {
  id: string;
  status: 'created' | 'training' | 'completed' | 'failed';
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
        // Cartesia recommends setting the language explicitly where possible.
        language: VOICE_LANGUAGE,
        output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
      },
      'cartesia',
    ),
    format: 'mp3' as const,
  }),

  /** Pro Voice Clone: dataset, files, fine-tune, then the voice it produced. */
  createClone: async ({ displayName, sampleFiles }) => {
    if (sampleFiles.length === 0) {
      throw new TransportError('cartesia PVC needs at least one sample file');
    }
    const auth = headers();
    const description = `Humanness Index source voice ${displayName}`;

    const dataset = await requestJson<Dataset>(
      'POST',
      `${API}/datasets`,
      auth,
      { name: displayName, description },
      'cartesia datasets/create',
    );

    // A PVC trains on the whole dataset, so upload every sample.
    for (const file of sampleFiles) {
      const form = new FormData();
      form.append('file', new Blob([readFileSync(file)], { type: 'audio/wav' }), basename(file));
      form.append('purpose', 'fine_tune');
      await postFormNoContent(
        `${API}/datasets/${dataset.id}/files`,
        auth,
        form,
        `cartesia datasets/upload-file ${basename(file)}`,
      );
    }

    const started = await requestJson<FineTune>(
      'POST',
      `${API}/fine-tunes`,
      auth,
      {
        name: displayName,
        description,
        language: VOICE_LANGUAGE,
        model_id: PVC_BASE_MODEL,
        dataset: dataset.id,
      },
      'cartesia fine-tunes/create',
    );

    // The voice only exists once training completes, so poll for it.
    const deadline = Date.now() + TRAINING_TIMEOUT_MS;
    for (;;) {
      const { status, user_errors } = await requestJson<FineTune>(
        'GET',
        `${API}/fine-tunes/${started.id}`,
        auth,
        undefined,
        'cartesia fine-tunes/get',
      );
      if (status === 'completed') break;
      if (status === 'failed') {
        const detail = (user_errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
        throw new TransportError(
          `cartesia fine-tune ${started.id} failed${detail ? ` (${detail})` : ''}`,
        );
      }
      if (Date.now() > deadline) {
        throw new TransportError(
          `cartesia fine-tune ${started.id} still ${status} after ` +
            `${TRAINING_TIMEOUT_MS / 3_600_000}h. Re-attach with GET /fine-tunes/${started.id} ` +
            `rather than starting a second one (PVC fine-tunes consume a plan slot).`,
        );
      }
      console.log(`  cartesia fine-tune ${started.id}: ${status}`);
      await sleep(POLL_INTERVAL_MS);
    }

    const voices = await requestJson<FineTuneVoices>(
      'GET',
      `${API}/fine-tunes/${started.id}/voices`,
      auth,
      undefined,
      'cartesia fine-tunes/list-voices',
    );
    // One fine-tune yields one voice; the models it serves sit a level below
    // the fine-tune.
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
        jsonError: (payload) =>
          payload.type === 'error' || payload.error ? JSON.stringify(payload) : null,
      }),
  }),
};
