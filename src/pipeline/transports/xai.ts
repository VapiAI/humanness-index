/**
 * xAI (Grok TTS) transport — TTFB bench surface only.
 *
 * No synthesize/createClone: the hosted arena clips were team-supplied.
 *
 * Both Grok configs speak the same realtime WebSocket wss://api.x.ai/v1/tts
 * (verified live with this key on 2026-06-12); per the team, the two Index
 * models differ ONLY by the `optimize_streaming_latency` param — enabled for
 * "Grok TTS (Streaming)", disabled for plain "Grok TTS". The bench therefore
 * holds everything else constant and toggles that one flag.
 *
 * Protocol per xAI's public realtime TTS docs (docs.x.ai), verified live:
 * connection params ride
 * the URL query (voice/codec/sample_rate/language/speed/
 * optimize_streaming_latency) with an Authorization: Bearer header; the
 * client sends {type:"text.delta",delta} frames then {type:"text.done"};
 * audio streams back as binary PCM frames (JSON audio.delta events with
 * base64 `delta` also exist in the protocol; both count as first audio).
 *
 * HTTP note: the documented batch route POST /v1/tts works with this key
 * (200, audio/mpeg); only the legacy /v1/audio/speech path 403s.
 */
import { requireEnv } from '../env';
import { sleep } from '../lib';
import { BENCH_TEXT, wsTtfbTrial } from './http';
import {
  RateLimitedError,
  type ProviderTransport,
  type TtfbPlan,
  type TtfbTrialResult,
} from './types';

const WS_URL = 'wss://api.x.ai/v1/tts';
/** Built-in voice (eve/ara/rex/sal/leo) — no clone dependency for the bench. */
const BENCH_VOICE = 'eve';
/** PCM s16le; 24 kHz matches the pipeline's other WS benches. */
const SAMPLE_RATE = 24_000;
const RETRY_PAUSE_MS = 500;

const apiKey = (): string => requireEnv('XAI_API_KEY');

const benchUrl = (optimizeStreamingLatency: boolean): string => {
  const url = new URL(WS_URL);
  url.searchParams.set('voice', BENCH_VOICE);
  url.searchParams.set('codec', 'pcm');
  url.searchParams.set('sample_rate', String(SAMPLE_RATE));
  url.searchParams.set('language', 'en');
  url.searchParams.set('speed', '1');
  url.searchParams.set(
    'optimize_streaming_latency',
    optimizeStreamingLatency ? '1' : '0',
  );
  return url.toString();
};

const attemptTrial = (optimizeStreamingLatency: boolean): Promise<TtfbTrialResult> =>
  wsTtfbTrial({
    url: benchUrl(optimizeStreamingLatency),
    headers: { Authorization: `Bearer ${apiKey()}` },
    // Connection is established before t0 inside wsTtfbTrial (the bench
    // methodology); t0 at the first text.delta send, t1 at first audio.
    framesFor: () => [
      JSON.stringify({ type: 'text.delta', delta: BENCH_TEXT }),
      JSON.stringify({ type: 'text.done' }),
    ],
    jsonHasAudio: (payload) =>
      payload.type === 'audio.delta' &&
      typeof payload.delta === 'string' &&
      payload.delta.length > 0,
    jsonError: (payload) =>
      payload.type === 'error' ? JSON.stringify(payload) : null,
    timeoutMs: 30_000,
  });

/** One in-trial retry for transient WS drops; 429s propagate so the bench backs off. */
const trialWith = (optimizeStreamingLatency: boolean) =>
  async (): Promise<TtfbTrialResult> => {
    try {
      return await attemptTrial(optimizeStreamingLatency);
    } catch (error) {
      if (error instanceof RateLimitedError) throw error;
      await sleep(RETRY_PAUSE_MS);
      return attemptTrial(optimizeStreamingLatency);
    }
  };

export const xai: ProviderTransport = {
  providerId: 'xai',
  apiKeyEnv: 'XAI_API_KEY',

  ttfbPlanFor: (vendorModelId): TtfbPlan => {
    // The two Grok configs are the same WS API; they differ only by the
    // optimize_streaming_latency flag (per the team, 2026-06-12).
    const optimize = vendorModelId === 'streaming';
    return {
      transport: 'websocket',
      notes: `native realtime WS wss://api.x.ai/v1/tts (text.delta/text.done, pcm 24kHz, built-in voice eve), optimize_streaming_latency=${optimize ? '1' : '0'}; one in-trial retry`,
      trial: trialWith(optimize),
    };
  },
};
