/**
 * Inworld transport. Synthesis via the REST voice endpoint with Basic auth
 * (INWORLD_API_KEY is a base64 Basic token), MP3 at 48 kHz — the format of
 * the hosted Inworld clips. Request shape ported from the original
 * prototype's Inworld adapter; TTFB over the bidirectional
 * streaming WS, same 50-trial protocol (the transport that produced the
 * published 337/288 ms medians).
 */
import { readFileSync } from 'node:fs';

import { requireEnv } from '../env';
import { BENCH_TEXT, decodeBase64Audio, requestJson, wsTtfbTrial } from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const API = 'https://api.inworld.ai';
/** Stock voice the original 50-trial bench used. */
const BENCH_VOICE = 'Alex';

const authHeader = (): string => `Basic ${requireEnv('INWORLD_API_KEY')}`;

type InworldSynthesisResponse = {
  audioContent?: string;
  result?: { audioContent?: string };
};

export const inworld: ProviderTransport = {
  providerId: 'inworld',
  apiKeyEnv: 'INWORLD_API_KEY',

  synthesize: async ({ vendorModelId, providerVoiceId, text }) => {
    const payload = await requestJson<InworldSynthesisResponse>(
      'POST',
      `${API}/tts/v1/voice`,
      { authorization: authHeader() },
      {
        text,
        voiceId: providerVoiceId,
        modelId: vendorModelId,
        audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 48000 },
      },
      'inworld tts',
    );
    const audioContent = payload.audioContent ?? payload.result?.audioContent;
    if (!audioContent) {
      throw new TransportError('inworld returned no audioContent');
    }
    return { bytes: decodeBase64Audio(audioContent), format: 'mp3' as const };
  },

  createClone: async ({ displayName, sampleFiles }) => {
    // Inworld instant cloning: POST /voices/v1/voices:clone with base64
    // voiceSamples (docs.inworld.ai/api-reference/voiceAPI/voiceservice/
    // clone-voice). Requires a key with the `voices` write scope. The 60s
    // request timeout plus one retry guards against the upload hanging.
    if (sampleFiles.length === 0) {
      throw new TransportError('inworld cloning needs one sample file');
    }
    const body = {
      displayName,
      langCode: 'EN_US',
      voiceSamples: sampleFiles.map((file) => ({
        audioData: Buffer.from(readFileSync(file)).toString('base64'),
      })),
      description: 'Humanness Index licensed source voice clone',
      audioProcessingConfig: { removeBackgroundNoise: false },
    };
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await requestJson<{ voice?: { voiceId?: string } }>(
          'POST',
          `${API}/voices/v1/voices:clone`,
          { authorization: authHeader() },
          body,
          'inworld voices:clone',
        );
        const voiceId = payload.voice?.voiceId;
        if (!voiceId) {
          throw new TransportError('inworld clone returned no voiceId');
        }
        return voiceId;
      } catch (error) {
        lastError = error;
        // 4xx scope/validation errors will not improve on retry.
        if (error instanceof TransportError && /HTTP 4\d\d/.test(error.message)) {
          throw error;
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new TransportError(String(lastError));
  },

  ttfbPlanFor: (vendorModelId): TtfbPlan => ({
    transport: 'websocket',
    trial: () => {
      const contextId = `bench-${Date.now()}`;
      return wsTtfbTrial({
        url: `wss://api.inworld.ai/tts/v1/voice:streamBidirectional`,
        headers: { Authorization: authHeader() },
        framesFor: () => [
          JSON.stringify({
            create: {
              voiceId: BENCH_VOICE,
              modelId: vendorModelId,
              audioConfig: {
                audioEncoding: 'LINEAR16',
                sampleRateHertz: 24000,
                speakingRate: 1.0,
              },
            },
            contextId,
          }),
          JSON.stringify({ send_text: { text: BENCH_TEXT }, contextId }),
          JSON.stringify({ flush_context: {}, contextId }),
        ],
        jsonHasAudio: (payload) => Boolean(inworldAudioOf(payload)),
        jsonError: (payload) => {
          if (
            typeof payload.code === 'number' &&
            typeof payload.message === 'string' &&
            !inworldAudioOf(payload)
          ) {
            return JSON.stringify(payload);
          }
          return null;
        },
      });
    },
  }),
};

const inworldAudioOf = (payload: Record<string, unknown>): string | null => {
  const result = (payload.result ?? {}) as Record<string, unknown>;
  const chunk = (result.audioChunk ?? {}) as Record<string, unknown>;
  const audio = chunk.audioContent ?? result.audioContent;
  return typeof audio === 'string' && audio.length > 0 ? audio : null;
};

/** List voices visible to this account (stock + workspace clones). */
export const inworldListVoices = async (): Promise<
  Array<{ voiceId?: string; name?: string; displayName?: string }>
> => {
  const payload = await requestJson<{
    voices?: Array<{ voiceId?: string; name?: string; displayName?: string }>;
  }>('GET', `${API}/tts/v1/voices`, { authorization: authHeader() }, undefined, 'inworld voices');
  return payload.voices ?? [];
};
