/**
 * Fish Audio transport (s2.1-pro).
 *
 * Synthesis + TTFB ride the same realtime WebSocket:
 * `wss://api.fish.audio/v1/tts/live`, msgpack-framed (`@msgpack/msgpack`).
 * Protocol per the Fish docs and the in-house Fish CLI reference
 * (code/fish/cli/index.js): client sends a `start` frame with the request,
 * a `text` frame with the line, then `flush` + `stop`; server replies with
 * `audio` frames carrying mp3 bytes and a terminal `finish` frame. The
 * Index entry uses `latency: "balanced"` because a local bench (June 2026,
 * n=20 per mode) measured balanced ~18 ms faster at the median than
 * `latency: "low"`, despite the name.
 *
 * Clone creation (`createClone`) hits the documented multipart
 * `POST https://api.fish.audio/model` (instant cloning, `train_mode: "fast"`,
 * private model), per
 * https://docs.fish.audio/developer-guide/sdk-guide/cookbook/instant-voice-cloning
 * and verified against code/fish/livekit-demo/fish/src/voice_clone.py. The
 * returned model id is what the synth `reference_id` points at.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { decode, encode } from '@msgpack/msgpack';

import { requireEnv } from '../env';
import { BENCH_TEXT, postFormForJson } from './http';
import {
  RateLimitedError,
  TransportError,
  type ProviderTransport,
  type TtfbPlan,
  type TtfbTrialResult,
} from './types';

const WS_URL = 'wss://api.fish.audio/v1/tts/live';
const CLONE_URL = 'https://api.fish.audio/model';
/** Streaming-optimised mode; see the doc comment above for the local bench. */
const LATENCY: 'balanced' | 'low' | 'normal' = 'balanced';
const TRIAL_TIMEOUT_MS = 30_000;
const SYNTH_TIMEOUT_MS = 60_000;

const apiKey = (): string => requireEnv('FISH_API_KEY');

type ServerEvent =
  | { event: 'audio'; audio: Uint8Array }
  | { event: 'finish' }
  | { event: 'log'; level?: string; message?: string }
  | { event: string; [key: string]: unknown };

const decodeFrame = (data: ArrayBuffer): ServerEvent | null => {
  try {
    const value = decode(new Uint8Array(data));
    if (typeof value !== 'object' || value === null) return null;
    return value as ServerEvent;
  } catch {
    return null;
  }
};

const openWs = (vendorModelId: string): WebSocket => {
  const ws = new WebSocket(
    WS_URL,
    {
      headers: { Authorization: `Bearer ${apiKey()}`, model: vendorModelId },
    } as unknown as string[] | undefined,
  );
  ws.binaryType = 'arraybuffer';
  return ws;
};

const synthOverWs = (
  vendorModelId: string,
  providerVoiceId: string,
  text: string,
): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const ws = openWs(vendorModelId);
    const chunks: Uint8Array[] = [];
    let settled = false;
    const finish = (cb: () => void) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // already closed
      }
      cb();
    };
    const timer = setTimeout(() => {
      finish(() =>
        reject(new TransportError('fish ws synth: no finish within timeout')),
      );
    }, SYNTH_TIMEOUT_MS);

    ws.onopen = () => {
      try {
        ws.send(
          encode({
            event: 'start',
            request: {
              text: '',
              format: 'mp3',
              latency: LATENCY,
              reference_id: providerVoiceId,
            },
          }),
        );
        ws.send(encode({ event: 'text', text: `${text} ` }));
        ws.send(encode({ event: 'flush' }));
        ws.send(encode({ event: 'stop' }));
      } catch (err) {
        clearTimeout(timer);
        finish(() => reject(err as Error));
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const msg = decodeFrame(event.data);
      if (!msg) return;
      if (msg.event === 'audio') {
        const audio = (msg as { audio?: unknown }).audio;
        if (audio instanceof Uint8Array) chunks.push(audio);
        return;
      }
      if (msg.event === 'finish') {
        clearTimeout(timer);
        if (chunks.length === 0) {
          finish(() => reject(new TransportError('fish ws synth: no audio')));
          return;
        }
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.length;
        }
        finish(() => resolve(out));
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      finish(() => reject(new TransportError('fish ws synth: socket error')));
    };
    ws.onclose = (event: CloseEvent) => {
      clearTimeout(timer);
      finish(() => {
        if (chunks.length === 0) {
          reject(
            new TransportError(
              `fish ws synth: closed before finish (code ${event.code} ${event.reason})`.trim(),
            ),
          );
        }
      });
    };
  });

/**
 * TTFB trial: fresh WS per trial, connectMs covers the handshake before t0,
 * t0 right after the `text` frame is buffered (matches the in-house Fish
 * CLI's textSentAt), t1 at the first inbound `audio` frame carrying bytes.
 * Bench omits `reference_id` so it runs without a clone dependency; once
 * the arena Clara clone exists locally, pin it here for parity with the
 * other providers' WS benches.
 */
const fishTtfbTrial = (vendorModelId: string): Promise<TtfbTrialResult> =>
  new Promise((resolve, reject) => {
    const tConnect = performance.now();
    const ws = openWs(vendorModelId);
    let t0 = 0;
    let connectMs = 0;
    let settled = false;
    const finish = (cb: () => void) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // already closed
      }
      cb();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new TransportError('fish ws bench: no audio within timeout')));
    }, TRIAL_TIMEOUT_MS);

    ws.onopen = () => {
      connectMs = performance.now() - tConnect;
      try {
        ws.send(
          encode({
            event: 'start',
            request: { text: '', format: 'mp3', latency: LATENCY },
          }),
        );
        ws.send(encode({ event: 'text', text: `${BENCH_TEXT} ` }));
        t0 = performance.now();
        ws.send(encode({ event: 'flush' }));
        ws.send(encode({ event: 'stop' }));
      } catch (err) {
        clearTimeout(timer);
        finish(() => reject(err as Error));
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const msg = decodeFrame(event.data);
      if (!msg || t0 === 0) return;
      if (msg.event === 'audio') {
        const audio = (msg as { audio?: unknown }).audio;
        if (audio instanceof Uint8Array && audio.length > 0) {
          const ttfbMs = performance.now() - t0;
          clearTimeout(timer);
          finish(() => resolve({ ttfbMs, connectMs }));
        }
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      finish(() => reject(new TransportError('fish ws bench: socket error')));
    };
    ws.onclose = (event: CloseEvent) => {
      clearTimeout(timer);
      finish(() =>
        reject(
          new TransportError(
            `fish ws bench: closed before audio (code ${event.code} ${event.reason})`.trim(),
          ),
        ),
      );
    };
  });

export const fish: ProviderTransport = {
  providerId: 'fish',
  apiKeyEnv: 'FISH_API_KEY',

  synthesize: async ({ vendorModelId, providerVoiceId, text }) => ({
    bytes: await synthOverWs(vendorModelId, providerVoiceId, text),
    format: 'mp3' as const,
  }),

  createClone: async ({ displayName, sampleFiles }) => {
    const form = new FormData();
    form.append('type', 'tts');
    form.append('title', displayName);
    form.append('train_mode', 'fast');
    form.append('visibility', 'private');
    form.append('enhance_audio_quality', 'true');
    for (const file of sampleFiles) {
      form.append(
        'voices',
        new Blob([readFileSync(file)], { type: 'audio/wav' }),
        basename(file),
      );
    }
    const result = await postFormForJson<{ _id: string }>(
      CLONE_URL,
      { Authorization: `Bearer ${apiKey()}` },
      form,
      'fish create-model',
    );
    return result._id;
  },

  ttfbPlanFor: (vendorModelId): TtfbPlan => ({
    transport: 'websocket',
    notes: `wss://api.fish.audio/v1/tts/live (msgpack frames: start/text/flush/stop; audio/finish back), model=${vendorModelId}, latency=${LATENCY}, mp3 chunks, no reference_id (stock voice for the bench)`,
    trial: async (): Promise<TtfbTrialResult> => {
      try {
        return await fishTtfbTrial(vendorModelId);
      } catch (error) {
        if (error instanceof RateLimitedError) throw error;
        return fishTtfbTrial(vendorModelId);
      }
    },
  }),
};
