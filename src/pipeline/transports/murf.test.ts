import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { murf } from './murf';
import { BENCH_TEXT } from './http';

const originalKey = process.env.MURF_API_KEY;
const realWebSocket = globalThis.WebSocket;
afterEach(() => {
  if (originalKey === undefined) delete process.env.MURF_API_KEY;
  else process.env.MURF_API_KEY = originalKey;
  globalThis.WebSocket = realWebSocket;
});

describe('Murf Falcon 2.1', () => {
  it('sends the exact model, clone and frozen text as raw PCM and rejects other model families', async () => {
    process.env.MURF_API_KEY = 'test-key';
    let endpoint: unknown;
    let request: RequestInit | undefined;
    const mock = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          endpoint = url;
          request = init;
          return new Response(new Uint8Array([1, 2, 3, 4]));
        },
        { preconnect: fetch.preconnect },
      ),
    );
    try {
      const result = await murf.synthesize!({
        vendorModelId: 'falcon-2.1',
        providerVoiceId: 'cln_test',
        text: 'Wait... sorry, the billing tab.',
      });
      expect(endpoint).toBe('https://global.api.murf.ai/v1/speech/stream');
      expect(new Headers(request?.headers).get('api-key')).toBe('test-key');
      expect(JSON.parse(String(request?.body))).toEqual({
        model: 'falcon-2.1',
        voiceId: 'cln_test',
        text: 'Wait... sorry, the billing tab.',
        locale: 'en-US',
        format: 'PCM',
        sampleRate: 24000,
        channelType: 'MONO',
        rate: 0,
        pitch: 0,
      });
      expect(result.format).toBe('pcm');
      expect(result.sampleRate).toBe(24000);
      await expect(
        murf.synthesize!({
          vendorModelId: 'gen2',
          providerVoiceId: 'cln_test',
          text: 'test',
        }),
      ).rejects.toThrow('supports only');
    } finally {
      mock.mockRestore();
    }
  });

  it('recovers an existing tagged clone without another upload', async () => {
    process.env.MURF_API_KEY = 'test-key';
    const mock = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async () =>
          Response.json([
            { tag: 'humanness-index-voice-clara', voiceId: 'cln_existing' },
          ]),
        { preconnect: fetch.preconnect },
      ),
    );
    try {
      expect(
        await murf.createClone!({
          voiceKey: 'voice-clara',
          displayName: 'Arena Clara',
          sampleFiles: ['not-read.wav'],
        }),
      ).toBe('cln_existing');
      expect(mock).toHaveBeenCalledTimes(1);
    } finally {
      mock.mockRestore();
    }
  });

  it('uploads a sample and waits for the asynchronous completed voice ID', async () => {
    process.env.MURF_API_KEY = 'test-key';
    const dir = mkdtempSync(resolve(tmpdir(), 'murf-test-'));
    const sample = resolve(dir, 'sample.wav');
    writeFileSync(sample, 'test wav');
    const receipt = resolve(
      import.meta.dir,
      '../results/murf/clone-jobs/voice-test.json',
    );
    rmSync(receipt, { force: true });
    let form: FormData | undefined;
    const mock = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          if (String(url).endsWith('/cloned')) return Response.json([]);
          if (String(url).endsWith('/create')) {
            form = init?.body as FormData;
            return Response.json({ requestId: 'job-test' });
          }
          expect(String(url)).toEndWith('/voice-clone-creation-status/job-test');
          return Response.json({ status: 'COMPLETED', voiceId: 'cln_finished' });
        },
        { preconnect: fetch.preconnect },
      ),
    );
    try {
      expect(
        await murf.createClone!({
          voiceKey: 'voice-test',
          displayName: 'Arena Test',
          sampleFiles: [sample],
        }),
      ).toBe('cln_finished');
      expect(form?.get('tag')).toBe('humanness-index-voice-test');
      expect(form?.get('audio')).toBeInstanceOf(Blob);
    } finally {
      mock.mockRestore();
      rmSync(dir, { recursive: true, force: true });
      rmSync(receipt, { force: true });
    }
  });

  it('sends matching voice/text contexts after connection open, ignores empty audio and fails on fallback warnings', async () => {
    process.env.MURF_API_KEY = 'test-key';
    let endpoint = '';
    const frames: Record<string, unknown>[] = [];
    let warning = false;
    class FakeSocket {
      binaryType = '';
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      constructor(url: string) {
        endpoint = url;
        queueMicrotask(() => this.onopen?.());
      }
      send(value: string) {
        frames.push(JSON.parse(value));
        if (frames.length % 2 === 0)
          queueMicrotask(() => {
            this.onmessage?.({ data: JSON.stringify({ audio: '' }) });
            this.onmessage?.({
              data: JSON.stringify(
                warning
                  ? { warning: 'default voice fallback', warning_code: 'NO_VOICE_CONFIG' }
                  : { audio: 'AQI=' },
              ),
            });
          });
      }
      close() {}
    }
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const plan = murf.ttfbPlanFor!('falcon-2.1');
    if ('unmeasurable' in plan) throw Error(plan.unmeasurable);
    expect((await plan.trial()).ttfbMs).toBeGreaterThanOrEqual(0);
    const query = new URL(endpoint).searchParams;
    expect(query.get('model')).toBe('falcon-2.1');
    expect(query.get('format')).toBe('PCM');
    expect(query.get('api-key')).toBe('test-key');
    expect(frames[0].context_id).toBe(frames[1].context_id);
    expect((frames[0].voice_config as Record<string, unknown>).voiceId).toStartWith(
      'cln_',
    );
    expect(frames[1].text).toBe(BENCH_TEXT);
    expect(frames[1].end).toBe(true);
    warning = true;
    await expect(plan.trial()).rejects.toThrow('NO_VOICE_CONFIG');
  });

  it('resumes a persisted job and surfaces failure without another upload', async () => {
    process.env.MURF_API_KEY = 'test-key';
    const receipt = resolve(
      import.meta.dir,
      '../results/murf/clone-jobs/voice-test-resume.json',
    );
    mkdirSync(resolve(receipt, '..'), { recursive: true });
    writeFileSync(receipt, JSON.stringify({ requestId: 'existing-job' }));
    const mock = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          expect(init?.method).toBe('GET');
          if (String(url).endsWith('/cloned')) return Response.json([]);
          expect(String(url)).toEndWith('/voice-clone-creation-status/existing-job');
          return Response.json({ status: 'FAILED', errorMessage: 'sample rate too low' });
        },
        { preconnect: fetch.preconnect },
      ),
    );
    try {
      await expect(
        murf.createClone!({
          voiceKey: 'voice-test-resume',
          displayName: 'Test',
          sampleFiles: ['not-read.wav'],
        }),
      ).rejects.toThrow('sample rate too low');
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      mock.mockRestore();
      rmSync(receipt, { force: true });
    }
  });
});
