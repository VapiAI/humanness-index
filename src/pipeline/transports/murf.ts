/**
 * Murf Falcon 2.1: workspace-owned instant clones, HTTP PCM synthesis and
 * first-audio timing over an established WebSocket. Verified 2026-10-27.
 * https://murf.ai/api/docs/voices-styles/instant-voice-cloning
 * https://murf.ai/api/docs/text-to-speech/web-sockets
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { requireEnv } from '../env';
import { sleep } from '../lib';
import { requireVoiceMap } from '../voices';
import {
  BENCH_TEXT,
  postFormForJson,
  postJsonForBytes,
  requestJson,
  wsTtfbTrial,
} from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const API = 'https://api.murf.ai';
const STREAM_API = 'https://global.api.murf.ai';
const MODEL = 'falcon-2.1';
const SAMPLE_RATE = 24000;
const JOB_DIR = resolve(import.meta.dir, '../results/murf/clone-jobs');
const headers = (): Record<string, string> => ({ 'api-key': requireEnv('MURF_API_KEY') });

type MurfClone = { voiceId: string; displayName: string; tag: string };
type CloneStatus = { status: string; voiceId?: string; errorMessage?: string };

export const murfListClones = (): Promise<MurfClone[]> =>
  requestJson(
    'GET',
    `${API}/v1/speech/voices/cloned`,
    headers(),
    undefined,
    'murf list clones',
  );

const assertModel = (model: string): void => {
  if (model !== MODEL)
    throw new TransportError(`Murf transport supports only ${MODEL}, received ${model}`);
};

export const murf: ProviderTransport = {
  providerId: 'murf',
  apiKeyEnv: 'MURF_API_KEY',

  synthesize: async ({ vendorModelId, providerVoiceId, text }) => {
    assertModel(vendorModelId);
    return {
      bytes: await postJsonForBytes(
        `${STREAM_API}/v1/speech/stream`,
        headers(),
        {
          model: vendorModelId,
          voiceId: providerVoiceId,
          text,
          locale: 'en-US',
          format: 'PCM',
          sampleRate: SAMPLE_RATE,
          channelType: 'MONO',
          rate: 0,
          pitch: 0,
        },
        'murf speech stream',
      ),
      format: 'pcm',
      sampleRate: SAMPLE_RATE,
    };
  },

  createClone: async ({ voiceKey, displayName, sampleFiles }) => {
    if (sampleFiles.length !== 1)
      throw new TransportError(
        'Murf needs exactly one prepared sample per voice (max 30 s, >=24 kHz, <=40 MB)',
      );
    if (!/^voice-[a-z0-9-]+$/.test(voiceKey))
      throw new TransportError('Invalid Murf source voice key');
    const tag = `humanness-index-${voiceKey}`;
    // Recover workspace clones before creating anything, including after an
    // interrupted run that finished server-side but did not persist local IDs.
    const existing = (await murfListClones()).find((voice) => voice.tag === tag);
    if (existing) return existing.voiceId;
    mkdirSync(JOB_DIR, { recursive: true });
    const receiptPath = resolve(JOB_DIR, `${voiceKey}.json`);
    let requestId: string;
    if (existsSync(receiptPath)) {
      requestId = (JSON.parse(readFileSync(receiptPath, 'utf8')) as { requestId: string })
        .requestId;
    } else {
      const sample = readFileSync(sampleFiles[0]);
      if (!sample.length || sample.length > 40 * 1024 * 1024)
        throw new TransportError('Murf sample is empty or exceeds 40 MB');
      const form = new FormData();
      form.append('tag', tag);
      form.append('displayName', displayName);
      form.append(
        'audio',
        new Blob([sample], { type: 'audio/wav' }),
        basename(sampleFiles[0]),
      );
      const job = await postFormForJson<{ requestId?: string }>(
        `${API}/v1/speech/voices/create`,
        headers(),
        form,
        'murf create clone',
      );
      if (!job.requestId)
        throw new TransportError('Murf clone response contains no requestId');
      requestId = job.requestId;
      // Retain the receipt before polling so a timeout cannot create duplicates.
      writeFileSync(
        receiptPath,
        `${JSON.stringify({ requestId, tag, displayName }, null, 2)}\n`,
      );
    }
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (attempt) await sleep(2000);
      const status = await requestJson<CloneStatus>(
        'GET',
        `${API}/v1/speech/voice-clone-creation-status/${encodeURIComponent(requestId)}`,
        headers(),
        undefined,
        'murf clone status',
      );
      if (status.status === 'COMPLETED') {
        if (!status.voiceId?.startsWith('cln_'))
          throw new TransportError('Murf completed clone has no valid voiceId');
        return status.voiceId;
      }
      if (status.status === 'FAILED')
        throw new TransportError(
          `Murf clone failed: ${status.errorMessage ?? 'no detail'} (receipt: ${receiptPath})`,
        );
      if (!['QUEUED', 'PROCESSING'].includes(status.status))
        throw new TransportError(`Unknown Murf clone status: ${status.status}`);
    }
    throw new TransportError(
      `Murf clone still pending; resume using receipt ${receiptPath}`,
    );
  },

  ttfbPlanFor: (vendorModelId): TtfbPlan => {
    assertModel(vendorModelId);
    return {
      transport: 'websocket (PCM 24 kHz)',
      notes:
        'Falcon 2.1 global router; arena Clara instant clone; en-US; 24 kHz mono PCM; default rate/pitch; request send after connection open to first nonempty audio; includes network RTT.',
      trial: () => {
        const query = new URLSearchParams({
          'api-key': requireEnv('MURF_API_KEY'),
          model: vendorModelId,
          format: 'PCM',
          sample_rate: String(SAMPLE_RATE),
          channel_type: 'MONO',
        });
        const context = `bench-${crypto.randomUUID()}`;
        return wsTtfbTrial({
          url: `wss://global.api.murf.ai/v1/speech/stream-input?${query}`,
          framesFor: () => [
            JSON.stringify({
              voice_config: {
                voiceId: requireVoiceMap('murf')['voice-clara'],
                locale: 'en-US',
                rate: 0,
                pitch: 0,
              },
              context_id: context,
            }),
            JSON.stringify({ text: BENCH_TEXT, end: true, context_id: context }),
          ],
          jsonHasAudio: (payload) =>
            typeof payload.audio === 'string' &&
            Buffer.from(payload.audio, 'base64').length > 0,
          jsonError: (payload) =>
            payload.error || payload.warning
              ? JSON.stringify({
                  error: payload.error ?? payload.warning,
                  code: payload.error_code ?? payload.warning_code,
                })
              : null,
        });
      },
    };
  },
};
