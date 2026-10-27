import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { resolvePipelineModel } from '../models';
import { requireVoiceMap, voiceMapKeyForModel } from '../voices';
import { elevenlabs } from './elevenlabs';
import { synthesizeDialogue } from './elevenlabsDialogue';
import { BENCH_TEXT } from './http';

const originalSocket = globalThis.WebSocket;
const originalKey = process.env.ELEVENLABS_API_KEY;
afterEach(() => {
  globalThis.WebSocket = originalSocket;
  if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = originalKey;
});

const installSocket = (mode: 'complete' | 'early-close' | 'error' = 'complete') => {
  const observed = { url: '', headers: {} as Record<string, string>, frames: [] as Record<string, unknown>[] };
  class FakeSocket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    onclose?: (event: { code: number; reason: string }) => void;
    constructor(url: string, options: { headers: Record<string, string> }) {
      observed.url = url;
      observed.headers = options.headers;
      queueMicrotask(() => this.onopen?.());
    }
    send(value: string) {
      const frame = JSON.parse(value);
      observed.frames.push(frame);
      if (!frame.close_socket) return;
      queueMicrotask(() => {
        const emit = (data: unknown) => this.onmessage?.({ data: JSON.stringify(data) });
        emit({ audio: '' });
        if (mode === 'error') { emit({ error: { code: 429, message: 'rate limit' } }); return; }
        emit({ audio: 'AQI=' });
        emit({ is_final_audio_for_turn: true });
        if (mode === 'early-close') { this.onclose?.({ code: 1006, reason: 'interrupted' }); return; }
        emit({ audio: 'AwQ=' });
        emit({ is_final: true });
      });
    }
    close() {}
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  return observed;
};

describe('ElevenLabs v4 integration', () => {
  it('keeps old identities and clone mappings separate from the v4 family', () => {
    const models = ['elevenlabs-eleven-v4', 'elevenlabs-eleven-v4-turbo'].map(resolvePipelineModel);
    expect(models.map(model => model.vendorModelId)).toEqual(['eleven_v4', 'eleven_v4_turbo']);
    expect(models.map(model => model.arenaApiId)).toEqual(['eleven_v4', 'eleven_v4_turbo']);
    expect(voiceMapKeyForModel('elevenlabs', 'eleven_v3')).toBe('elevenlabs');
    expect(voiceMapKeyForModel('elevenlabs', 'eleven_v4')).toBe('elevenlabs-v4');
    expect(voiceMapKeyForModel('elevenlabs', 'eleven_v4_turbo')).toBe('elevenlabs-v4');
    expect(requireVoiceMap('elevenlabs')['voice-clara']).toBe('ScCxrqX5aNtDVkIsrVZ1');
    expect(requireVoiceMap('elevenlabs', 'eleven_v4')['voice-clara']).toBe('8gfyLJBl74bSIkLdjo6i');
  });

  it('uses the exact model and clone, preserves text, and waits for all final audio', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    const observed = installSocket();
    const text = "Okay... wait, that's the original script.";
    const result = await elevenlabs.synthesize!({ vendorModelId: 'eleven_v4_turbo', providerVoiceId: 'licensed-clone', text });
    const url = new URL(observed.url);
    expect(url.pathname).toBe('/v1/text-to-dialogue/stream-input');
    expect(url.searchParams.get('model_id')).toBe('eleven_v4_turbo');
    expect(url.searchParams.get('output_format')).toBe('mp3_44100_128');
    expect(url.searchParams.get('language_code')).toBe('en');
    expect(observed.headers).toEqual({ 'xi-api-key': 'test-key' });
    expect(observed.frames).toEqual([
      { voices: ['licensed-clone'], voice_settings: { stability: 0.35, similarity_boost: 0.95 } },
      { inputs: [{ text, voice_id: 'licensed-clone', new_turn: false }] },
      { close_socket: true },
    ]);
    expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4]);
    expect(result.format).toBe('mp3');
  });

  it('rejects truncated streams even after receiving a turn-final marker', async () => {
    installSocket('early-close');
    await expect(synthesizeDialogue('eleven_v4', 'clone', 'script', 'test-key')).rejects.toThrow('closed before final audio');
  });

  it('propagates rate limits without returning partial audio', async () => {
    installSocket('error');
    await expect(synthesizeDialogue('eleven_v4', 'clone', 'script', 'test-key')).rejects.toThrow('rate limit');
  });

  it('benchmarks PCM with the actual Clara v4 clone and flushes the short bench text', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    const observed = installSocket();
    const plan = elevenlabs.ttfbPlanFor!('eleven_v4');
    if ('unmeasurable' in plan) throw new Error(plan.unmeasurable);
    const result = await plan.trial();
    const url = new URL(observed.url);
    expect(url.searchParams.get('model_id')).toBe('eleven_v4');
    expect(url.searchParams.get('output_format')).toBe('pcm_24000');
    expect(observed.frames[0].voices).toEqual(['8gfyLJBl74bSIkLdjo6i']);
    expect(observed.frames[1].inputs).toEqual([{ text: BENCH_TEXT, voice_id: '8gfyLJBl74bSIkLdjo6i', new_turn: false }]);
    expect(observed.frames[2]).toEqual({ close_socket: true });
    expect(result.ttfbMs).toBeGreaterThanOrEqual(0);
  });

  it('preserves legacy synthesis settings and the single-voice HTTP endpoint', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    let endpoint: unknown;
    let request: RequestInit | undefined;
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
      endpoint = url;
      request = init;
      return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0]));
    }, { preconnect: fetch.preconnect }));
    try {
      await elevenlabs.synthesize!({ vendorModelId: 'eleven_flash_v2_5', providerVoiceId: 'original-clone', text: 'unchanged' });
      expect(endpoint).toBe('https://api.elevenlabs.io/v1/text-to-speech/original-clone?output_format=mp3_44100_128');
      expect(JSON.parse(String(request?.body))).toEqual({
        text: 'unchanged', model_id: 'eleven_flash_v2_5',
        voice_settings: { stability: 0.35, similarity_boost: 0.95, style: 0.5, use_speaker_boost: true },
      });
    } finally { fetchSpy.mockRestore(); }
  });
});
