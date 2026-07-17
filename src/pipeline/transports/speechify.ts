/**
 * Speechify transport (Simba family). Request shapes verified live against
 * api.speechify.ai on 2026-07-17 (see the RUNBOOK status table): synthesis is
 * `POST /v1/audio/speech` returning JSON with base64 `audio_data`; cloning is
 * multipart `POST /v1/voices` with a consent declaration (create + synth +
 * delete round-trip verified on a throwaway voice); TTFB runs on the chunked
 * HTTP `POST /v1/audio/stream` route. The API strictly validates `model`
 * (bogus ids 400 with the valid list), so per-model clips are genuine.
 *
 * Simba 3.2 caveat: cloned voices currently list only simba-english /
 * simba-multilingual, so simba-3.2 synthesis is limited to the eight stock
 * `*_32` shared voices until Speechify enables clones for it. The bench
 * therefore pins a stock 3.2 voice; switch it to the arena Clara clone once
 * clones can run 3.2.
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import { requireEnv } from '../env';
import {
  BENCH_TEXT,
  anyBytesMarker,
  decodeBase64Audio,
  httpStreamTrial,
  postFormForJson,
  requestJson,
} from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const API = 'https://api.speechify.ai';
/** Stock voices for the bench: simba-3.2 has no clone support yet. */
const BENCH_VOICES: Record<string, string> = {
  'simba-3.2': 'harper_32',
};
const DEFAULT_BENCH_VOICE = 'cleon';

const apiKey = (): string => requireEnv('SPEECHIFY_API_KEY');

export const speechify: ProviderTransport = {
  providerId: 'speechify',
  apiKeyEnv: 'SPEECHIFY_API_KEY',

  synthesize: async ({ vendorModelId, providerVoiceId, text }) => {
    const result = await requestJson<{ audio_data?: string }>(
      'POST',
      `${API}/v1/audio/speech`,
      { authorization: `Bearer ${apiKey()}` },
      {
        input: text,
        voice_id: providerVoiceId,
        model: vendorModelId,
        audio_format: 'mp3',
      },
      'speechify',
    );
    if (!result.audio_data) {
      throw new TransportError('speechify returned no audio_data');
    }
    return { bytes: decodeBase64Audio(result.audio_data), format: 'mp3' as const };
  },

  createClone: async ({ displayName, sampleFiles }) => {
    // The clone endpoint takes a single `sample` file plus a consent
    // declaration naming the voice owner (the maintainer running the clone).
    const sampleFile = sampleFiles[0];
    const mimeType = extname(sampleFile).toLowerCase() === '.mp3' ? 'audio/mpeg' : 'audio/wav';
    const form = new FormData();
    form.append('name', displayName);
    form.append(
      'sample',
      new Blob([readFileSync(sampleFile)], { type: mimeType }),
      basename(sampleFile),
    );
    form.append(
      'consent',
      JSON.stringify({
        fullName: requireEnv('SPEECHIFY_CONSENT_FULL_NAME'),
        email: requireEnv('SPEECHIFY_CONSENT_EMAIL'),
      }),
    );
    const result = await postFormForJson<{ id: string }>(
      `${API}/v1/voices`,
      { authorization: `Bearer ${apiKey()}` },
      form,
      'speechify voices',
    );
    return result.id;
  },

  ttfbPlanFor: (vendorModelId): TtfbPlan => ({
    transport: 'http-stream',
    notes:
      'chunked HTTP /v1/audio/stream; stock bench voice until clones can run simba-3.2',
    trial: () =>
      httpStreamTrial(
        `${API}/v1/audio/stream`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey()}`,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            input: BENCH_TEXT,
            voice_id: BENCH_VOICES[vendorModelId] ?? DEFAULT_BENCH_VOICE,
            model: vendorModelId,
          }),
        },
        anyBytesMarker,
      ),
  }),
};
