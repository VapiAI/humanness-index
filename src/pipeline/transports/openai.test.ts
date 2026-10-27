import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openai, uploadOpenaiConsent } from './openai';
import { LIVE_MODEL, LIVE_URL, runOpenaiLiveProbe, spokenWords } from './openaiLiveProbe';
import { resolvePipelineModel } from '../models';

const oldKey = process.env.OPENAI_API_KEY;
const oldProject = process.env.OPENAI_PROJECT_ID;
const realWebSocket = globalThis.WebSocket;
let testProjectDir: string | undefined;
afterEach(() => {
  if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = oldKey;
  if (oldProject === undefined) delete process.env.OPENAI_PROJECT_ID;
  else process.env.OPENAI_PROJECT_ID = oldProject;
  globalThis.WebSocket = realWebSocket;
  if (testProjectDir) rmSync(testProjectDir, { recursive: true, force: true });
  testProjectDir = undefined;
});
const setup = (): void => {
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_PROJECT_ID = `proj_test_${randomUUID()}`;
  testProjectDir = resolve(import.meta.dir, '../results/openai', process.env.OPENAI_PROJECT_ID);
};

describe('OpenAI pending integration and consent controls', () => {
  it('resolves the exact pending model without enabling arena synthesis or misleading latency', () => {
    const model = resolvePipelineModel('openai-gpt-live-1');
    expect(model.registered).toBe(false);
    expect(model.vendorModelId).toBe(LIVE_MODEL);
    expect(openai.synthesize).toBeUndefined();
    expect(openai.ttfbPlanFor!(LIVE_MODEL)).toHaveProperty('unmeasurable');
  });

  it('requires an actor consent before sending licensed reference audio', async () => {
    setup();
    const fetchMock = spyOn(globalThis, 'fetch');
    try {
      await expect(openai.createClone!({ voiceKey: 'voice-clara', displayName: 'Arena Clara', sampleFiles: ['never-read.wav'] })).rejects.toThrow('Actual actor consent');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { fetchMock.mockRestore(); }
  });

  it('persists separate consent and clone receipts, reuses them and isolates projects', async () => {
    setup();
    const files = mkdtempSync(resolve(tmpdir(), 'openai-voices-test-'));
    const consent = resolve(files, 'consent.webm');
    const sample = resolve(files, 'sample.wav');
    writeFileSync(consent, 'actual-actor-recording-fixture');
    writeFileSync(sample, 'licensed-reference-fixture');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({ id: String(url).endsWith('voice_consents') ? 'cons_test' : 'voice_test' });
    }, { preconnect: fetch.preconnect }));
    try {
      expect(await uploadOpenaiConsent('voice-clara', consent)).toBe('cons_test');
      expect(await uploadOpenaiConsent('voice-clara', consent)).toBe('cons_test');
      const args = { voiceKey: 'voice-clara', displayName: 'Arena Clara', sampleFiles: [sample] };
      expect(await openai.createClone!(args)).toBe('voice_test');
      expect(await openai.createClone!(args)).toBe('voice_test');
      expect(calls.length).toBe(2);
      const consentForm = calls[0].init?.body as FormData;
      const voiceForm = calls[1].init?.body as FormData;
      expect(calls[0].url).toBe('https://api.openai.com/v1/audio/voice_consents');
      expect(consentForm.get('language')).toBe('en');
      expect((consentForm.get('recording') as Blob).type).toBe('audio/webm');
      expect(voiceForm.get('consent')).toBe('cons_test');
      expect(voiceForm.get('audio_sample')).toBeInstanceOf(Blob);
      expect(voiceForm.get('prompt')).toBeNull();
      expect(new Headers(calls[1].init?.headers).get('OpenAI-Project')).toBe(process.env.OPENAI_PROJECT_ID!);
      const receipt = JSON.parse(readFileSync(resolve(testProjectDir!, 'voices.json'), 'utf8'));
      expect(receipt.voices['voice-clara'].voiceId).toBe('voice_test');
      writeFileSync(sample, 'different-reference-fixture');
      await expect(openai.createClone!(args)).rejects.toThrow('Different sample');
      process.env.OPENAI_PROJECT_ID = `proj_other_${randomUUID()}`;
      await expect(openai.createClone!(args)).rejects.toThrow('Actual actor consent');
      expect(calls.length).toBe(2);
    } finally { mock.mockRestore(); rmSync(files, { recursive: true, force: true }); }
  });

  it('does not retry or save invented IDs after an authorization failure', async () => {
    setup();
    const dir = mkdtempSync(resolve(tmpdir(), 'openai-denied-test-'));
    const consent = resolve(dir, 'consent.wav');
    writeFileSync(consent, 'actor-fixture');
    const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => new Response('permission denied', { status: 403 }), { preconnect: fetch.preconnect }));
    try {
      await expect(uploadOpenaiConsent('voice-emma', consent)).rejects.toThrow('HTTP 403');
      expect(mock).toHaveBeenCalledTimes(1);
    } finally { mock.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('GPT-Live experimental rendering protocol', () => {
  const text = 'Okay, um, let me... let me check.';
  const timing = { deadlineMs: 120, finalizationMs: 35, quietMs: 20 };
  type Scenario = 'ok' | 'changed' | 'wrong-model' | 'wrong-voice' | 'silent' | 'zero-pcm' | 'bad-audio' | 'no-final' | 'late-words' | 'early-audio' | 'denied';
  const installSocket = (scenario: Scenario): Record<string, any>[] => {
    const frames: Record<string, any>[] = [];
    class Socket {
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      onclose?: () => void;
      constructor(url: string, options: { headers: Record<string, string> }) {
        expect(url).toBe(LIVE_URL);
        expect(options.headers.Authorization).toBe('Bearer test-key');
        queueMicrotask(() => this.onopen?.());
      }
      emit(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
      send(value: string) {
        const event = JSON.parse(value);
        frames.push(event);
        if (event.type === 'session.start') queueMicrotask(() => {
          if (scenario === 'early-audio') this.emit({ type: 'session.output_audio.delta', delta: 'AQI=' });
          else if (scenario === 'denied') this.emit({ type: 'error', error: { type: 'invalid_request_error', code: 'permission_denied' } });
          else this.emit({ type: 'session.started', session: { model: scenario === 'wrong-model' ? 'gpt-realtime' : LIVE_MODEL, audio: { output: { voice: { id: scenario === 'wrong-voice' ? 'voice_other' : 'voice_test' } } } } });
        });
        if (event.type === 'session.instructions.append' && scenario !== 'silent') queueMicrotask(() => {
          this.emit({ type: 'session.output_audio.delta', delta: '' });
          if (scenario === 'bad-audio') { this.emit({ type: 'session.output_audio.delta', delta: '%%%' }); return; }
          this.emit({ type: 'session.output_audio.delta', delta: Buffer.from(scenario === 'zero-pcm' ? [0, 0, 0, 0] : [0, 32, 0, 32]).toString('base64') });
          this.emit({ type: 'session.output_transcript.delta', delta: scenario === 'changed' ? 'Sure! I will check.' : text, start_ms: 0, end_ms: 1000 });
        });
        if (event.type === 'session.close' && scenario !== 'no-final') queueMicrotask(() => {
          if (scenario === 'late-words') this.emit({ type: 'session.output_transcript.delta', delta: ' Anything else?' });
          this.emit({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 1.2 } });
        });
      }
      close() {}
    }
    globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    return frames;
  };

  it('waits for session readiness, sends an explicit script trigger and paced silence, and finalizes', async () => {
    setup();
    const frames = installSocket('ok');
    const result = await runOpenaiLiveProbe({ voiceId: 'voice_test', text }, timing);
    expect(frames[0].type).toBe('session.start');
    expect(frames[0].session.model).toBe(LIVE_MODEL);
    expect(frames[0].session.audio.output.voice).toEqual({ id: 'voice_test' });
    expect(frames[0].session.delegation).toEqual({ type: 'client' });
    expect(frames[0].session.store).toBe(false);
    expect(frames[1].type).toBe('session.input_audio.append');
    expect(frames[2].type).toBe('session.instructions.append');
    expect(frames[2].content).toContain(text);
    expect(frames.filter(frame => frame.type === 'session.instructions.append').length).toBe(1);
    expect(result.audio.length).toBe(4);
    expect(result.finalized).toBe(true);
    expect(result.transcriptMatches).toBe(true);
    expect(result.triggerToFirstAudioMs).toBeGreaterThanOrEqual(0);
    expect(result.usageSeconds).toBe(1.2);
    expect(result.issues).toEqual([]);
  });

  for (const [scenario, issue] of [
    ['changed', 'Changed or additional'], ['wrong-model', 'Resolved model'], ['wrong-voice', 'Resolved model'],
    ['silent', 'deadline'], ['bad-audio', 'Malformed base64'],
    ['zero-pcm', 'No audible speech'], ['denied', 'permission_denied'],
    ['no-final', 'No session.closed'], ['late-words', 'transcript differs'],
    ['early-audio', 'before script trigger'],
  ] as const) it(`retains a failed ${scenario} attempt without retrying`, async () => {
    setup();
    const frames = installSocket(scenario);
    const result = await runOpenaiLiveProbe({ voiceId: 'voice_test', text }, timing);
    expect(result.issues.join('; ')).toContain(issue);
    expect(frames.filter(frame => frame.type === 'session.start').length).toBe(1);
  });

  it('retains benchmark fillers and repeated words in the fidelity comparison', () => {
    expect(spokenWords('Okay... UM, let me, let me check!')).toBe(spokenWords(text));
    expect(spokenWords('Okay let me check')).not.toBe(spokenWords(text));
  });
});
