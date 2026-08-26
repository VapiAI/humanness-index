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
import { BENCH_TEXT, postJsonForBytes, requestJson, throwForStatus, wsTtfbTrial } from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const API = 'https://api.cartesia.ai';

/** Cartesia's current published API version, sent on every call. */
const VERSION = '2026-08-14';

/** Stock library voice, so the bench matches how other providers are measured. */
const BENCH_VOICE = 'f786b574-daa5-4673-aa0c-cbe3e8534c02';

/** Sample uploads are large; matches the shared multipart timeout. */
const UPLOAD_TIMEOUT_MS = 180_000;

/** The four licensed source voices are English (see pipeline/voices.ts). */
const VOICE_LANGUAGE = 'en';

/** Train against Sonic 3.5; PVCs forward-fill onto new models as they ship. */
const PVC_BASE_MODEL = 'sonic-3.5-2026-05-04';

/** Bearer is the documented scheme; x-api-key is the pre-2026 form. */
const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${requireEnv('CARTESIA_API_KEY')}`,
  'Cartesia-Version': VERSION,
});

type Dataset = { id: string };
type FineTune = { id: string };

/** Where training is tracked and the finished voice id is collected. */
const PVC_DASHBOARD = 'https://play.cartesia.ai';

/**
 * Upload one sample to a dataset. Separate from the shared postFormForJson
 * helper because this endpoint answers 204 with no body, so there is nothing
 * to parse.
 */
const uploadSample = async (
  datasetId: string,
  file: string,
  headers: Record<string, string>,
): Promise<void> => {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)], { type: 'audio/wav' }), basename(file));
  form.append('purpose', 'fine_tune');
  const response = await fetch(`${API}/datasets/${datasetId}/files`, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  await throwForStatus(response, `cartesia datasets/upload-file ${basename(file)}`);
};

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

  /** Pro Voice Clone: dataset, files, then kick off the fine-tune. */
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
      await uploadSample(dataset.id, file, auth);
    }

    const fineTune = await requestJson<FineTune>(
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

    // Training can take up to 3 hours, so this returns instead of waiting.
    // All four voices kick off in one run and train concurrently. Null means
    // there is no voice id yet; collect it once training finishes and persist
    // it with `humanness:clone cartesia --record <voice-key>=<voice-id>`.
    console.log(
      `  ${fineTune.id} started. Training takes up to 3 hours; collect the ` +
        `voice id from ${PVC_DASHBOARD} once it completes.`,
    );
    return null;
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
