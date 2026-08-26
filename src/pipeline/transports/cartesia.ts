/**
 * Cartesia transport. Synthesis ported from the original prototype's
 * Cartesia adapter (tts/bytes, mp3 44.1 kHz /
 * 128 kbps); instant cloning per
 * https://docs.cartesia.ai/build-with-cartesia/capability-guides/clone-voices;
 * TTFB over the realtime WS, same 50-trial protocol (arena Clara clone).
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { requireEnv } from '../env';
import { BENCH_TEXT, postFormForJson, postJsonForBytes, wsTtfbTrial } from './http';
import type { ProviderTransport, TtfbPlan } from './types';

const API = 'https://api.cartesia.ai';

/** Cartesia's current published API version, sent on every call. */
const VERSION = '2026-08-14';

/** The arena Clara clone, the voice the original 50-trial bench used. */
const BENCH_VOICE = 'a5d537b0-4a5f-464d-ac12-d143fe1a0a36';

/** The four licensed source voices are English (see pipeline/voices.ts). */
const VOICE_LANGUAGE = 'en';

/** Bearer is the documented scheme; x-api-key is the pre-2026 form. */
const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${requireEnv('CARTESIA_API_KEY')}`,
  'Cartesia-Version': VERSION,
});

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

  createClone: async ({ displayName, sampleFiles }) => {
    const form = new FormData();
    form.append(
      'clip',
      new Blob([readFileSync(sampleFiles[0])], { type: 'audio/wav' }),
      basename(sampleFiles[0]),
    );
    form.append('name', displayName);
    form.append('language', VOICE_LANGUAGE);
    form.append('mode', 'similarity');
    const result = await postFormForJson<{ id: string }>(
      `${API}/voices/clone`,
      headers(),
      form,
      'cartesia voices/clone',
    );
    return result.id;
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
