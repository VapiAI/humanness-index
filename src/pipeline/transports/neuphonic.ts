/**
 * Neuphonic transport. Synthesis ported from the original prototype's
 * Neuphonic adapter (SSE, base64 PCM events);
 * instant cloning (>=6 s clip, <=10 MB) verified live 2026-06-12:
 * POST /voices?voice_name=… (multipart `voice_file`) — the SDKs' voices.clone.
 *
 * MODEL SELECTION DOES NOT EXIST on the current public API (verified
 * 2026-06-12): `model`/`tts_model`/`model_id` in the SSE body, nested legacy
 * body, query params, and the WS endpoint are ALL ignored — even bogus
 * model names return audio, and neu_fast/neu_hq/omitted have identical
 * first-audio latency distributions (~285 ms median). One served pool today.
 * We still send `model: vendorModelId` so clips stay correct if Neuphonic
 * ever re-honors the field. Only neu_hq is generated for the Index; see
 * RUNBOOK status table for the neu_fast consequence.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { requireEnv } from '../env';
import {
  BENCH_TEXT,
  decodeBase64Audio,
  httpStreamTrial,
  postFormForJson,
  throwForStatus,
} from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const SSE_API = 'https://us-west4.api.neuphonic.com';
const API = 'https://api.neuphonic.com';
const SAMPLE_RATE = 24000;

const apiKey = (): string => requireEnv('NEUPHONIC_API_KEY');

const sseBody = (text: string, voiceId: string, vendorModelId?: string): string =>
  JSON.stringify({
    text,
    // An EMPTY voice_id is rejected with an in-stream 500 error event
    // (verified 2026-06-12); omit the field for the server default voice.
    ...(voiceId ? { voice_id: voiceId } : {}),
    speed: 1,
    sampling_rate: SAMPLE_RATE,
    encoding: 'pcm_linear',
    // Ignored by the API today (verified live) — kept for forward-compat.
    ...(vendorModelId ? { model: vendorModelId } : {}),
  });

const sseHeaders = (): Record<string, string> => ({
  'x-api-key': apiKey(),
  'content-type': 'application/json',
  accept: 'text/event-stream',
});

export const neuphonic: ProviderTransport = {
  providerId: 'neuphonic',
  apiKeyEnv: 'NEUPHONIC_API_KEY',

  synthesize: async ({ vendorModelId, providerVoiceId, text }) => {
    const response = await fetch(`${SSE_API}/sse/speak/en`, {
      method: 'POST',
      headers: sseHeaders(),
      body: sseBody(text, providerVoiceId, vendorModelId),
      signal: AbortSignal.timeout(60_000),
    });
    await throwForStatus(response, 'neuphonic sse/speak');
    const raw = await response.text();
    const chunks: Uint8Array[] = [];
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = JSON.parse(line.slice(5).trim()) as {
        data?: { audio?: string };
      };
      const audio = payload.data?.audio;
      if (audio) chunks.push(decodeBase64Audio(audio));
    }
    if (chunks.length === 0) {
      throw new TransportError('neuphonic SSE stream contained no audio');
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return { bytes, format: 'pcm' as const, sampleRate: SAMPLE_RATE };
  },

  createClone: async ({ displayName, sampleFiles }) => {
    const form = new FormData();
    form.append(
      'voice_file',
      new Blob([readFileSync(sampleFiles[0])], { type: 'audio/wav' }),
      basename(sampleFiles[0]),
    );
    const result = await postFormForJson<{
      data?: { voice_id?: string; id?: string };
      voice_id?: string;
    }>(
      `${API}/voices?voice_name=${encodeURIComponent(displayName)}&lang_code=en`,
      { 'x-api-key': apiKey() },
      form,
      'neuphonic voices clone',
    );
    const voiceId = result.data?.voice_id ?? result.data?.id ?? result.voice_id;
    if (!voiceId) {
      throw new TransportError(
        `neuphonic clone returned no voice_id (keys: ${Object.keys(result.data ?? result).join(',')})`,
      );
    }
    return voiceId;
  },

  ttfbPlanFor: (): TtfbPlan => ({
    transport: 'http-sse',
    notes: 'first audio SSE event on /sse/speak/en (default voice)',
    trial: () =>
      httpStreamTrial(
        `${SSE_API}/sse/speak/en`,
        { method: 'POST', headers: sseHeaders(), body: sseBody(BENCH_TEXT, '') },
        audioEventMarker,
      ),
  }),
};

/**
 * Marker: any SSE event mentioning an `"audio"` field. Looser than the shared
 * audioJsonFieldMarker (no `:"…"` shape assumption) to match the detection the
 * published 276 ms median was measured with.
 */
const audioEventMarker = (buffer: Uint8Array): boolean =>
  new TextDecoder().decode(buffer).includes('"audio"');
