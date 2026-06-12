/**
 * Hume transport (Octave / Octave 2). Synthesis ported from the original
 * prototype's Hume adapter. Clone CREATION is Platform-UI
 * only (https://dev.hume.ai/docs/voice/voice-cloning.mdx) — the API can use
 * and manage clones but not create them — so cloneVoices emits a manual
 * runbook instead of calling an endpoint.
 */
import { requireEnv } from '../env';
import {
  anyBytesMarker,
  BENCH_TEXT,
  decodeBase64Audio,
  httpStreamTrial,
  requestJson,
} from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const API = 'https://api.hume.ai';

const apiKey = (): string => requireEnv('HUME_API_KEY');

/** Heuristic: Hume custom-voice UUIDs vs stock voice names. */
const voiceRef = (providerVoiceId: string): Record<string, string> =>
  /^[0-9a-f-]{36}$/i.test(providerVoiceId)
    ? { id: providerVoiceId, provider: 'CUSTOM_VOICE' }
    : { name: providerVoiceId, provider: 'CUSTOM_VOICE' };

export const hume: ProviderTransport = {
  providerId: 'hume',
  apiKeyEnv: 'HUME_API_KEY',

  synthesize: async ({ providerVoiceId, text }) => {
    const payload = await requestJson<{
      generations?: Array<{ audio?: string }>;
    }>(
      'POST',
      `${API}/v0/tts`,
      { 'x-hume-api-key': apiKey() },
      {
        utterances: [{ text, voice: voiceRef(providerVoiceId) }],
        format: { type: 'mp3' },
        num_generations: 1,
      },
      'hume tts',
    );
    const audio = payload.generations?.[0]?.audio;
    if (!audio) throw new TransportError('hume returned no audio generation');
    return { bytes: decodeBase64Audio(audio), format: 'mp3' as const };
  },

  manualCloneRunbook: [
    'Hume clone creation is Platform-UI only (API can use clones, not create them):',
    '  1. Log in to platform.hume.ai with the account behind HUME_API_KEY.',
    '  2. Voices -> Create voice -> Clone, upload >=15 s of the source voice WAV.',
    '  3. Name it (e.g. "Arena Clara") and save.',
    '  4. Copy the voice id (or exact name) into pipeline/voices.local.json under',
    '     {"hume": {"voice-clara": "<id-or-name>", ...}} — or run',
    '     `bun run humanness:clone hume --record voice-clara=<id>` to persist it.',
  ].join('\n'),

  ttfbPlanFor: (vendorModelId): TtfbPlan => ({
    transport: 'http-stream (chunked)',
    notes: 'first chunk on /v0/tts/stream/file with a stock voice',
    trial: () =>
      httpStreamTrial(
        `${API}/v0/tts/stream/file`,
        {
          method: 'POST',
          headers: {
            'x-hume-api-key': apiKey(),
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            utterances: [
              {
                text: BENCH_TEXT,
                voice: { name: 'Male English Actor', provider: 'HUME_AI' },
              },
            ],
            format: { type: 'mp3' },
            version: vendorModelId,
          }),
        },
        anyBytesMarker,
      ),
  }),
};
