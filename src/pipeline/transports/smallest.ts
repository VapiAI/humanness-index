/**
 * Smallest.ai (Waves) transport — providerId `smallestai` (the frozen id in
 * variant hashes; the catalog will register the provider under the same id).
 *
 * Verified live 2026-06-12 against the v4 "unified" API:
 *  - synthesis: POST https://api.smallest.ai/waves/v1/tts with a `model`
 *    body field (`lightning_v3.1`). The legacy per-model
 *    /api/v1/{model}/get_speech route (ported from the original
 *    prototype's Smallest.ai adapter) and the dotted
 *    /waves/v1/lightning-v3.1/get_speech route are deprecated and retire
 *    2026-07-14 — do not build on them.
 *  - cloning: POST https://api.smallest.ai/waves/v1/voice-cloning
 *    (multipart displayName + file, 5-15 s sample, <=5 MB) returns a
 *    lightning-v3.1-compatible `voice_…` id. GET on the same path lists
 *    clones.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { requireEnv } from '../env';
import {
  anyBytesMarker,
  BENCH_TEXT,
  httpStreamTrial,
  postFormForJson,
  postJsonForBytes,
} from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const API = 'https://api.smallest.ai';

const apiKey = (): string => requireEnv('SMALLEST_AI_API_KEY');

const ttsBody = (vendorModelId: string, voiceId: string, text: string): object => ({
  text,
  voice_id: voiceId,
  model: vendorModelId,
  sample_rate: 24000,
  speed: 1,
  language: 'en',
  output_format: 'wav',
});

export const smallest: ProviderTransport = {
  providerId: 'smallestai',
  apiKeyEnv: 'SMALLEST_AI_API_KEY',

  synthesize: async ({ vendorModelId, providerVoiceId, text }) => ({
    bytes: await postJsonForBytes(
      `${API}/waves/v1/tts`,
      { authorization: `Bearer ${apiKey()}`, accept: 'audio/wav' },
      ttsBody(vendorModelId, providerVoiceId, text),
      'smallestai tts',
    ),
    format: 'wav' as const,
  }),

  createClone: async ({ displayName, sampleFiles }) => {
    const form = new FormData();
    form.append('displayName', displayName);
    form.append(
      'file',
      new Blob([readFileSync(sampleFiles[0])], { type: 'audio/wav' }),
      basename(sampleFiles[0]),
    );
    const result = await postFormForJson<{
      voiceId?: string;
      voice_id?: string;
      data?: { voiceId?: string; voice_id?: string; id?: string };
    }>(
      `${API}/waves/v1/voice-cloning`,
      { authorization: `Bearer ${apiKey()}` },
      form,
      'smallestai voice-cloning',
    );
    const voiceId =
      result.voiceId ?? result.voice_id ?? result.data?.voiceId ?? result.data?.voice_id ?? result.data?.id;
    if (!voiceId) {
      throw new TransportError(
        `smallestai clone returned no voice id (keys: ${Object.keys(result).join(',')})`,
      );
    }
    return voiceId;
  },

  ttfbPlanFor: (vendorModelId): TtfbPlan => ({
    transport: 'http-stream (chunked)',
    notes: 'first-chunk timing on unified /waves/v1/tts (WAV body)',
    trial: () =>
      httpStreamTrial(
        `${API}/waves/v1/tts`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey()}`,
            'content-type': 'application/json',
            accept: 'audio/wav',
          },
          body: JSON.stringify(ttsBody(vendorModelId, 'magnus', BENCH_TEXT)),
        },
        anyBytesMarker,
      ),
  }),
};
