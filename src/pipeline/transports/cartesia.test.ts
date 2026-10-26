import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { resolvePipelineModel } from '../models';
import { cartesia } from './cartesia';
import { BENCH_TEXT } from './http';

const realWebSocket = globalThis.WebSocket;
const originalKey = process.env.CARTESIA_API_KEY;

afterEach(() => {
  globalThis.WebSocket = realWebSocket;
  if (originalKey === undefined) delete process.env.CARTESIA_API_KEY;
  else process.env.CARTESIA_API_KEY = originalKey;
});

describe('Cartesia snapshot integration', () => {
  it('pins synthesis separately from Sonic 3.5 arena identities', () => {
    const old = resolvePipelineModel('cartesia-sonic-35');
    expect(old.arenaApiId).toBe('sonic-3.5');
    expect(old.vendorModelId).toBe('sonic-3.5-2026-05-04');
    const next = resolvePipelineModel('cartesia-sonic-36');
    expect(next.arenaApiId).toBe('sonic-3.6-2026-08-27');
    expect(next.vendorModelId).toBe('sonic-3.6-2026-08-27');
  });

  it('sends the exact snapshot, clone and English script using the current bytes API', async () => {
    process.env.CARTESIA_API_KEY = 'test-key';
    let request: RequestInit | undefined;
    let endpoint: unknown;
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
      endpoint = url;
      request = init;
      return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]));
    }, { preconnect: fetch.preconnect }));
    try {
      const audio = await cartesia.synthesize!({
        vendorModelId: 'sonic-3.6-2026-08-27',
        providerVoiceId: 'existing-professional-clone',
        text: 'The frozen script.',
      });
      expect(endpoint).toBe('https://api.cartesia.ai/tts/bytes');
      expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer test-key');
      expect(new Headers(request?.headers).get('Cartesia-Version')).toBe('2026-08-14');
      expect(JSON.parse(String(request?.body))).toEqual({
        model_id: 'sonic-3.6-2026-08-27',
        transcript: 'The frozen script.',
        voice: 'existing-professional-clone',
        language: 'en',
        output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
      });
      expect(audio.format).toBe('mp3');
      expect(audio.bytes.length).toBe(4);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('benchmarks raw PCM after opening the socket and propagates provider errors', async () => {
    process.env.CARTESIA_API_KEY = 'test-key';
    let endpoint = '';
    let options: { headers: Record<string, string> } | undefined;
    let frame: Record<string, unknown> = {};
    let fail = false;
    class FakeSocket {
      binaryType = '';
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      onerror?: () => void;
      onclose?: () => void;
      constructor(url: string, config: typeof options) {
        endpoint = url;
        options = config;
        queueMicrotask(() => this.onopen?.());
      }
      send(value: string) {
        frame = JSON.parse(value);
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify({ type: 'chunk', data: '' }) });
          this.onmessage?.({ data: JSON.stringify(fail
            ? { type: 'error', message: 'model not available', status_code: 400 }
            : { type: 'chunk', data: 'AQI=' }) });
        });
      }
      close() {}
    }
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const plan = cartesia.ttfbPlanFor!('sonic-3.6-2026-08-27');
    if ('unmeasurable' in plan) throw new Error(plan.unmeasurable);
    const result = await plan.trial();
    expect(endpoint).toBe('wss://api.cartesia.ai/tts/websocket');
    expect(options?.headers.Authorization).toBe('Bearer test-key');
    expect(options?.headers['Cartesia-Version']).toBe('2026-08-14');
    expect(frame.model_id).toBe('sonic-3.6-2026-08-27');
    expect(frame.transcript).toBe(BENCH_TEXT);
    expect(frame.voice).toBe('a5d537b0-4a5f-464d-ac12-d143fe1a0a36');
    expect(frame.language).toBe('en');
    expect(frame.output_format).toEqual({ container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 });
    expect(result.ttfbMs).toBeGreaterThanOrEqual(0);
    fail = true;
    await expect(plan.trial()).rejects.toThrow('model not available');
  });
});
