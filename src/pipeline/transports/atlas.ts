/**
 * Atlas transport, per https://docs.tts.runatlas.com (OpenAI-compatible
 * gateway at https://api.tts.runatlas.com, `Authorization: Bearer sk_…`).
 *
 *  - synthesis: POST /v1/audio/speech with `response_format: wav` (lossless
 *    into the arena encode). The `model` field is accepted for OpenAI SDK
 *    compatibility but ignored; the voice id selects the model, so the
 *    vendorModelId is sent only as a placeholder.
 *  - cloning: POST /v1/voices, JSON `{ name, audio_b64, consent: true }`.
 *    The reference must be a WAV of 3-12 s, so the first source sample is
 *    cut to its first 10 s and re-encoded as 24 kHz mono PCM WAV with ffmpeg
 *    (same single-sample convention as the other one-clip providers).
 *    English only, 10 clones per account.
 *  - TTFB: POST /v1/audio/speech with `response_format: pcm`, which streams
 *    headerless audio as it is synthesized; first body chunk = first audio.
 *    This is Atlas's lowest-latency mode, the bench convention (see the
 *    Speechify note in RUNBOOK). The WebSocket /v1/audio/speech/stream sends
 *    one frame per whole sentence and measured ~50 ms slower at the median
 *    (2026-10-08, 10 trials each: 579 ms WS vs 528 ms HTTP PCM). Its edge
 *    also 403s an upgrade with no User-Agent, which Bun's client omits.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { requireEnv } from '../env';
import { clonedVoiceIds } from '../voices';
import {
  anyBytesMarker,
  BENCH_TEXT,
  httpStreamTrial,
  postJsonForBytes,
  requestJson,
} from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const API = 'https://api.tts.runatlas.com';
/** Clone references must be 3-12 s; 10 s keeps clear of both edges. */
const CLONE_SECONDS = 10;
/** Stock global voice, used for the bench only when no arena clone exists. */
const STOCK_VOICE = 'capella';

const apiKey = (): string => requireEnv('ATLAS_API_KEY');

/** First CLONE_SECONDS of a sample as 24 kHz mono s16 WAV (temp files, no pipes). */
const cloneReferenceWav = (samplePath: string): Uint8Array => {
  const outPath = resolve(
    tmpdir(),
    `humanness-atlas-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );
  try {
    const result = spawnSync('ffmpeg', [
      '-y',
      '-i',
      samplePath,
      '-t',
      String(CLONE_SECONDS),
      '-ac',
      '1',
      '-ar',
      '24000',
      '-c:a',
      'pcm_s16le',
      outPath,
    ]);
    if (result.status !== 0 || !existsSync(outPath)) {
      throw new TransportError(
        `ffmpeg clone reference failed: ${result.stderr?.toString().slice(-300)}`,
      );
    }
    return new Uint8Array(readFileSync(outPath));
  } finally {
    rmSync(outPath, { force: true });
  }
};

/**
 * The arena Clara clone when it exists, so the bench times the same path
 * the arena clips come from; the stock voice otherwise.
 */
const benchVoice = (): string => clonedVoiceIds().atlas?.['voice-clara'] ?? STOCK_VOICE;

export const atlas: ProviderTransport = {
  providerId: 'atlas',
  apiKeyEnv: 'ATLAS_API_KEY',

  synthesize: async ({ vendorModelId, providerVoiceId, text }) => ({
    bytes: await postJsonForBytes(
      `${API}/v1/audio/speech`,
      { authorization: `Bearer ${apiKey()}`, accept: 'audio/wav' },
      {
        model: vendorModelId,
        voice: providerVoiceId,
        input: text,
        response_format: 'wav',
      },
      'atlas audio/speech',
    ),
    format: 'wav' as const,
  }),

  createClone: async ({ displayName, sampleFiles }) => {
    const result = await requestJson<{ id?: string }>(
      'POST',
      `${API}/v1/voices`,
      { authorization: `Bearer ${apiKey()}` },
      {
        name: displayName,
        audio_b64: Buffer.from(cloneReferenceWav(sampleFiles[0])).toString('base64'),
        consent: true,
      },
      'atlas voices',
    );
    if (!result.id) throw new TransportError('atlas clone returned no voice id');
    return result.id;
  },

  ttfbPlanFor: (vendorModelId): TtfbPlan => {
    const voice = benchVoice();
    return {
      transport: 'http-stream (chunked)',
      notes: `first-chunk timing on /v1/audio/speech (pcm), voice=${voice === STOCK_VOICE ? `${STOCK_VOICE} (stock)` : 'arena Clara clone'}`,
      trial: () =>
        httpStreamTrial(
          `${API}/v1/audio/speech`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${apiKey()}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: vendorModelId,
              voice,
              input: BENCH_TEXT,
              response_format: 'pcm',
            }),
          },
          anyBytesMarker,
        ),
    };
  },
};
