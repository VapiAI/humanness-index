/**
 * EXPERIMENTAL fixed-script probe, deliberately separate from synthesize/TTFB.
 * https://developers.openai.com/api/docs/guides/voice-websockets?api=live
 * https://developers.openai.com/api/docs/guides/live-conversations
 * Checked 2026-10-27. Live has no output-audio-done event or exact TTS command.
 */
import { openaiHeaders } from './openai';

export const LIVE_MODEL = 'gpt-live-1';
export const LIVE_URL = 'wss://api.openai.com/v1/live/sessions';
const RATE = 24000;
const FRAME_MS = 20;
const SILENCE = Buffer.alloc(RATE * 2 * FRAME_MS / 1000).toString('base64');

/** Ignore punctuation/case only. Never drop fillers, repeats or substitute words. */
export const spokenWords = (text: string): string =>
  text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ').trim().replace(/\s+/g, ' ');

export type ProbeResult = {
  model: typeof LIVE_MODEL;
  voiceId: string;
  text: string;
  transcript: string;
  transcriptMatches: boolean;
  audio: Uint8Array;
  sampleRate: number;
  finalized: boolean;
  closeReason?: string;
  usageSeconds?: number;
  connectMs: number | null;
  startupMs: number | null;
  /** Exploratory only: instructions.append send -> first nonempty audio delta. */
  triggerToFirstAudioMs: number | null;
  issues: string[];
  events: Array<{ type: string; receivedMs: number; delta?: string; startMs?: number; endMs?: number }>;
};

const hasSpeech = (bytes: Uint8Array): boolean => {
  const samples = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) sum += (samples.getInt16(i, true) / 32768) ** 2;
  return bytes.length > 0 && Math.sqrt(sum / (bytes.length / 2)) > 0.003;
};

export const runOpenaiLiveProbe = (
  { voiceId, text }: { voiceId: string; text: string },
  // Shorter deadlines are injected by protocol tests; CLI uses the fixed defaults.
  timing = { deadlineMs: 60000, finalizationMs: 15000, quietMs: 3000 },
): Promise<ProbeResult> => {
  if (!/^voice_[A-Za-z0-9_-]+$/.test(voiceId)) throw new Error('A recording-based custom voice ID is required');
  if (!text.trim() || text.length > 1800) throw new Error('Probe requires one bounded frozen script');
  const headers = openaiHeaders();
  return new Promise((resolveResult) => {
    const startedAt = performance.now();
    const result: ProbeResult = {
      model: LIVE_MODEL, voiceId, text, transcript: '', transcriptMatches: false,
      audio: new Uint8Array(), sampleRate: RATE, finalized: false,
      connectMs: null, startupMs: null, triggerToFirstAudioMs: null,
      issues: [], events: [],
    };
    const audio: Uint8Array[] = [];
    let totalBytes = 0;
    let ready = false;
    let closing = false;
    let settled = false;
    let triggerAt: number | null = null;
    let lastSpeechAt: number | null = null;
    let lastTranscriptAt: number | null = null;
    let silenceTimer: ReturnType<typeof setInterval> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const ws = new WebSocket(LIVE_URL, { headers } as unknown as string[]);
    const send = (event: unknown): void => { ws.send(JSON.stringify(event)); };
    const settle = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(closeTimer);
      clearInterval(silenceTimer);
      result.audio = new Uint8Array(Buffer.concat(audio));
      result.transcriptMatches = spokenWords(text) === spokenWords(result.transcript);
      if (!result.transcriptMatches) result.issues.push('Output transcript differs from frozen script');
      if (lastSpeechAt === null) result.issues.push('No audible speech detected');
      if (!result.finalized) result.issues.push('No session.closed: final usage unconfirmed');
      try { ws.close(); } catch { /* Already closed. */ }
      resolveResult(result);
    };
    const requestClose = (): void => {
      if (closing || settled) return;
      closing = true;
      clearTimeout(deadline);
      clearInterval(silenceTimer);
      if (!ready) { settle(); return; }
      closeTimer = setTimeout(settle, timing.finalizationMs);
      try { send({ type: 'session.close' }); } catch { settle(); }
    };
    const fail = (message: string): void => { result.issues.push(message); requestClose(); };
    const deadline = setTimeout(() => fail('Probe deadline reached; no complete verified utterance'), timing.deadlineMs);
    ws.onopen = () => {
      result.connectMs = performance.now() - startedAt;
      try { send({
        type: 'session.start', event_id: 'start',
        session: {
          model: LIVE_MODEL, store: false, delegation: { type: 'client' },
          instructions: 'Speak English using the selected reference voice. Remain silent until explicitly instructed to read a script. Read only that script verbatim, retaining all hesitations and repeated words. Add no introduction, answer, or commentary. After reading, stay silent.',
          audio: { format: { type: 'audio/pcm', rate: RATE }, output: { voice: { id: voiceId } } },
        },
      }); } catch { fail('Could not send session.start'); }
    };
    ws.onmessage = (event: MessageEvent) => {
      if (settled) return;
      const now = performance.now();
      try {
        if (typeof event.data !== 'string') { fail('Unexpected binary message'); return; }
        const message = JSON.parse(event.data) as Record<string, any>;
        const type = String(message.type);
        result.events.push({
          type, receivedMs: now - startedAt,
          ...(type === 'session.output_transcript.delta' ? {
            delta: message.delta, startMs: message.start_ms, endMs: message.end_ms,
          } : {}),
        });
        if (type === 'session.started') {
          if (ready || closing) { fail('Unexpected duplicate/late session.started'); return; }
          ready = true;
          result.startupMs = now - startedAt;
          if (message.session?.model !== LIVE_MODEL || message.session?.audio?.output?.voice?.id !== voiceId) {
            fail('Resolved model or recording voice differs from request'); return;
          }
          // Continuous silence advances the Live timeline. No external TTS input.
          send({ type: 'session.input_audio.append', audio: SILENCE });
          silenceTimer = setInterval(() => {
            try {
              send({ type: 'session.input_audio.append', audio: SILENCE });
              // Heuristic endpoint only. PCM quiet, matching transcript and an
              // additional transcript quiet interval; audio still needs ASR/listening.
              if (lastSpeechAt !== null && nowElapsed(lastSpeechAt) >= timing.quietMs &&
                  lastTranscriptAt !== null && nowElapsed(lastTranscriptAt) >= timing.quietMs &&
                  spokenWords(result.transcript) === spokenWords(text)) requestClose();
            } catch { fail('Could not send paced input silence'); }
          }, FRAME_MS);
          triggerAt = performance.now();
          send({
            type: 'session.instructions.append', event_id: 'read_script', delegation_id: null,
            content: `Immediately say the following script exactly and in full. Preserve every word, filler and self-correction. Then remain silent. Script: ${text}`,
          });
        } else if (type === 'session.output_audio.delta') {
          if (!ready || triggerAt === null) { fail('Audio arrived before script trigger'); return; }
          if (typeof message.delta !== 'string' || !message.delta.length) return;
          if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.delta)) {
            fail('Malformed base64 audio'); return;
          }
          const bytes = Buffer.from(message.delta, 'base64');
          if (!bytes.length) return;
          if (bytes.length % 2) { fail('Incomplete PCM16 sample'); return; }
          totalBytes += bytes.length;
          if (totalBytes > RATE * 2 * 65) { fail('Runaway output audio'); return; }
          if (result.triggerToFirstAudioMs === null) result.triggerToFirstAudioMs = now - triggerAt;
          audio.push(bytes);
          if (hasSpeech(bytes)) lastSpeechAt = now;
        } else if (type === 'session.output_transcript.delta') {
          if (!ready || triggerAt === null) { fail('Transcript arrived before script trigger'); return; }
          if (typeof message.delta !== 'string') { fail('Malformed transcript'); return; }
          result.transcript += message.delta;
          lastTranscriptAt = now;
          // Fail at first changed word, but allow the final word to be partial.
          const actual = spokenWords(result.transcript);
          const expected = spokenWords(text);
          if (actual && !expected.startsWith(actual)) fail('Changed or additional spoken wording');
        } else if (type === 'session.closed') {
          result.finalized = true;
          result.closeReason = message.reason;
          result.usageSeconds = message.usage?.seconds;
          if (!closing || message.reason !== 'close_requested') result.issues.push(`Unexpected session closure: ${message.reason}`);
          settle();
        } else if (type === 'error') {
          // No provider messages/headers in logs: preserve codes for access diagnosis.
          fail(`OpenAI error: ${message.error?.type ?? 'unknown'}/${message.error?.code ?? 'unknown'} (${message.error?.param ?? 'no parameter'})`);
        }
      } catch { fail('Malformed Live event or failed command'); }
    };
    ws.onerror = () => fail('Live WebSocket connection failed; inspect project access before retrying');
    ws.onclose = () => { if (!settled) settle(); };
  });
};

const nowElapsed = (since: number): number => performance.now() - since;
