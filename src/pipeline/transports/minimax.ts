/**
 * MiniMax transport. Synthesis ported from the original prototype's
 * MiniMax adapter (hex audio over t2a_v2, the shape
 * that generated the hosted MiniMax clips: mp3 32 kHz / 128 kbps mono).
 * Cloning per the MiniMax voice-clone flow
 * (https://platform.minimax.io/docs/api-reference/voice-cloning-clone):
 * file upload (purpose=voice_clone) then voice_clone with a caller-chosen
 * voice_id. TTFB via SSE streaming, same 50-trial protocol.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { requireEnv } from '../env';
import {
  audioJsonFieldMarker,
  BENCH_TEXT,
  decodeHexAudio,
  httpStreamTrial,
  postFormForJson,
  requestJson,
} from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const API = 'https://api.minimax.io';
/** Stock voice the original 50-trial bench used. */
const BENCH_VOICE = 'English_radiant_girl';

type BaseResp = { status_code: number; status_msg: string };

const apiKey = (): string => requireEnv('MINIMAX_API_KEY');

const groupIdSuffix = (): string => {
  const groupId = process.env.MINIMAX_GROUP_ID?.trim();
  return groupId ? `?GroupId=${groupId}` : '';
};

const checkBaseResp = (base: BaseResp | undefined, label: string): void => {
  if (base && base.status_code !== 0) {
    throw new TransportError(
      `${label} error ${base.status_code}: ${base.status_msg}`,
    );
  }
};

export const minimax: ProviderTransport = {
  providerId: 'minimax',
  apiKeyEnv: 'MINIMAX_API_KEY',

  synthesize: async ({ vendorModelId, providerVoiceId, text }) => {
    const payload = await requestJson<{
      data?: { audio?: string };
      base_resp?: BaseResp;
    }>(
      'POST',
      `${API}/v1/t2a_v2${groupIdSuffix()}`,
      { authorization: `Bearer ${apiKey()}` },
      {
        model: vendorModelId,
        text,
        stream: false,
        output_format: 'hex',
        language_boost: 'auto',
        voice_setting: {
          voice_id: providerVoiceId,
          speed: 1.0,
          vol: 1.0,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
      },
      'minimax t2a_v2',
    );
    checkBaseResp(payload.base_resp, 'minimax t2a_v2');
    const hex = payload.data?.audio;
    if (!hex) throw new TransportError('minimax returned no audio bytes');
    return { bytes: decodeHexAudio(hex), format: 'mp3' as const };
  },

  createClone: async ({ voiceKey, sampleFiles }) => {
    if (sampleFiles.length === 0) {
      throw new TransportError('minimax cloning needs at least one sample file');
    }
    const form = new FormData();
    form.append('purpose', 'voice_clone');
    form.append(
      'file',
      new Blob([readFileSync(sampleFiles[0])], { type: 'audio/wav' }),
      basename(sampleFiles[0]),
    );
    const uploaded = await postFormForJson<{
      file?: { file_id?: number | string };
      base_resp?: BaseResp;
    }>(
      `${API}/v1/files/upload${groupIdSuffix()}`,
      { authorization: `Bearer ${apiKey()}` },
      form,
      'minimax files/upload',
    );
    checkBaseResp(uploaded.base_resp, 'minimax files/upload');
    const fileId = uploaded.file?.file_id;
    if (fileId === undefined) {
      throw new TransportError('minimax upload returned no file_id');
    }
    // voice_id is caller-chosen and permanent after first synthesis; keep the
    // arena's existing naming scheme (minimax-clara, minimax-emma, ...).
    const voiceId = `minimax-${voiceKey.replace(/^voice-/, '')}`;
    const cloned = await requestJson<{ base_resp?: BaseResp }>(
      'POST',
      `${API}/v1/voice_clone${groupIdSuffix()}`,
      { authorization: `Bearer ${apiKey()}` },
      { file_id: fileId, voice_id: voiceId },
      'minimax voice_clone',
    );
    checkBaseResp(cloned.base_resp, 'minimax voice_clone');
    return voiceId;
  },

  ttfbPlanFor: (vendorModelId): TtfbPlan => ({
    transport: 'http-sse (stream=true)',
    trial: () =>
      httpStreamTrial(
        `${API}/v1/t2a_v2${groupIdSuffix()}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: vendorModelId,
            text: BENCH_TEXT,
            stream: true,
            voice_setting: {
              voice_id: BENCH_VOICE,
              speed: 1.0,
              vol: 1.0,
              pitch: 0,
            },
            audio_setting: {
              sample_rate: 24000,
              bitrate: 128000,
              format: 'mp3',
              channel: 1,
            },
          }),
        },
        audioJsonFieldMarker,
      ),
  }),
};

/** List cloned voices on the account (voice_cloning type). */
export const minimaxListClonedVoices = async (): Promise<
  Array<{ voice_id: string; description?: string[] }>
> => {
  const payload = await requestJson<{
    voice_cloning?: Array<{ voice_id: string; description?: string[] }>;
    base_resp?: BaseResp;
  }>(
    'POST',
    `${API}/v1/get_voice`,
    { authorization: `Bearer ${apiKey()}` },
    { voice_type: 'voice_cloning' },
    'minimax get_voice',
  );
  checkBaseResp(payload.base_resp, 'minimax get_voice');
  return payload.voice_cloning ?? [];
};
