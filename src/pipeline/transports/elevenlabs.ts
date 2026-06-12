/**
 * ElevenLabs transport. Synthesis ported from the original prototype's
 * ElevenLabs adapter (the path that generated the
 * hosted ElevenLabs clips): mp3_44100_128 output with the arena's
 * settings-v3 voice settings. Cloning per the IVC API
 * (https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning). TTFB
 * trials ported from the prototype's 50-trial bench.
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
  wsTtfbTrial,
} from './http';
import type { ProviderTransport, TtfbPlan } from './types';

const API = 'https://api.elevenlabs.io';
/** Matches the arena's settings-v3 generation parameters. */
const ARENA_VOICE_SETTINGS = {
  stability: 0.35,
  similarity_boost: 0.95,
  style: 0.5,
  use_speaker_boost: true,
};
/** Stock Rachel — the voice the original 50-trial bench used (comparability). */
const BENCH_VOICE = '21m00Tcm4TlvDq8ikWAM';
/** Models the realtime stream-input WS accepts (v3/multilingual are rejected). */
const REALTIME_WS_MODELS = new Set([
  'eleven_turbo_v2',
  'eleven_turbo_v2_5',
  'eleven_flash_v2',
  'eleven_flash_v2_5',
]);

const apiKey = (): string => requireEnv('ELEVENLABS_API_KEY');

export const elevenlabs: ProviderTransport = {
  providerId: 'elevenlabs',
  apiKeyEnv: 'ELEVENLABS_API_KEY',

  synthesize: async ({ vendorModelId, providerVoiceId, text }) => ({
    bytes: await postJsonForBytes(
      `${API}/v1/text-to-speech/${providerVoiceId}?output_format=mp3_44100_128`,
      { 'xi-api-key': apiKey(), accept: 'audio/mpeg' },
      {
        text,
        model_id: vendorModelId,
        voice_settings: ARENA_VOICE_SETTINGS,
      },
      'elevenlabs',
    ),
    format: 'mp3' as const,
  }),

  createClone: async ({ displayName, sampleFiles }) => {
    const form = new FormData();
    form.append('name', displayName);
    for (const file of sampleFiles) {
      form.append(
        'files',
        new Blob([readFileSync(file)], { type: 'audio/wav' }),
        basename(file),
      );
    }
    const result = await postFormForJson<{ voice_id: string }>(
      `${API}/v1/voices/add`,
      { 'xi-api-key': apiKey() },
      form,
      'elevenlabs voices/add',
    );
    return result.voice_id;
  },

  ttfbPlanFor: (vendorModelId): TtfbPlan => {
    if (REALTIME_WS_MODELS.has(vendorModelId)) {
      return {
        transport: 'websocket',
        trial: () =>
          wsTtfbTrial({
            url:
              `wss://api.elevenlabs.io/v1/text-to-speech/${BENCH_VOICE}/stream-input` +
              `?output_format=pcm_24000&model_id=${vendorModelId}&enable_logging=false`,
            framesFor: () => [
              JSON.stringify({ text: ' ', xi_api_key: apiKey() }),
              JSON.stringify({
                text: BENCH_TEXT,
                try_trigger_generation: true,
                flush: true,
              }),
              JSON.stringify({ text: '' }),
            ],
            jsonHasAudio: (payload) => Boolean(payload.audio),
            jsonError: (payload) =>
              payload.error ? JSON.stringify(payload) : null,
          }),
      };
    }
    // v3 and Multilingual v2 are rejected by the realtime stream-input WS
    // (handshake 403, not realtime models); their streaming surface is the
    // chunked HTTP /stream endpoint.
    return {
      transport: 'http-stream (chunked)',
      notes:
        'websocket stream-input rejects non-realtime models; measured on the chunked HTTP /stream endpoint',
      trial: () =>
        httpStreamTrial(
          `${API}/v1/text-to-speech/${BENCH_VOICE}/stream?output_format=mp3_44100_128`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': apiKey(),
              'content-type': 'application/json',
              accept: 'audio/mpeg',
            },
            body: JSON.stringify({ text: BENCH_TEXT, model_id: vendorModelId }),
          },
          anyBytesMarker,
        ),
    };
  },
};
