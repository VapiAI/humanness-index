/**
 * v4 models use the Text to Dialogue WebSocket, a different protocol from
 * Flash/Turbo's text-to-speech stream-input socket. One registered arena
 * clone reads one complete, unchanged prompt per connection.
 * https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket
 */
import { decodeBase64Audio, wsTtfbTrial, BENCH_TEXT } from './http';
import { RateLimitedError, TransportError, type SynthesisResult, type TtfbPlan } from './types';

const V4_SETTINGS = { stability: 0.35, similarity_boost: 0.95 };
const TIMEOUT_MS = 60_000;

const dialogueUrl = (model: string, outputFormat: string): string =>
  'wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input' +
  `?model_id=${encodeURIComponent(model)}&output_format=${outputFormat}&language_code=en`;

const frames = (voiceId: string, text: string): string[] => [
  JSON.stringify({ voices: [voiceId], voice_settings: V4_SETTINGS }),
  JSON.stringify({ inputs: [{ text, voice_id: voiceId, new_turn: false }] }),
  // This flushes the entire line, including prompts below the buffer threshold.
  JSON.stringify({ close_socket: true }),
];

const providerError = (payload: Record<string, unknown>): string | null =>
  payload.error ? JSON.stringify(payload.error) : null;

/** Wait for the final frame; an early close must never become a truncated clip. */
export const synthesizeDialogue = (
  model: string,
  voiceId: string,
  text: string,
  apiKey: string,
): Promise<SynthesisResult> => new Promise((resolve, reject) => {
  const socket = new WebSocket(dialogueUrl(model, 'mp3_44100_128'), {
    headers: { 'xi-api-key': apiKey },
  } as unknown as string[]);
  const chunks: Uint8Array[] = [];
  let settled = false;
  const finish = (error?: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.close();
    if (error) { reject(error); return; }
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (!bytes.length) reject(new TransportError('ElevenLabs dialogue returned empty audio'));
    else resolve({ bytes, format: 'mp3' });
  };
  const timer = setTimeout(() => finish(new TransportError('ElevenLabs dialogue timed out')), TIMEOUT_MS);
  socket.onmessage = (event: MessageEvent) => {
    if (typeof event.data !== 'string') {
      finish(new TransportError('Unexpected binary frame from ElevenLabs dialogue'));
      return;
    }
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(event.data); }
    catch { finish(new TransportError('Invalid JSON from ElevenLabs dialogue')); return; }
    const error = providerError(payload);
    if (error) {
      finish(/429|rate.limit/i.test(error)
        ? new RateLimitedError(`ElevenLabs dialogue: ${error.slice(0, 300)}`)
        : new TransportError(`ElevenLabs dialogue: ${error.slice(0, 300)}`));
      return;
    }
    if (typeof payload.audio === 'string' && payload.audio.length > 0) chunks.push(decodeBase64Audio(payload.audio));
    if (payload.is_final === true) finish();
  };
  socket.onopen = () => {
    try { for (const frame of frames(voiceId, text)) socket.send(frame); }
    catch (error) { finish(error instanceof Error ? error : new TransportError(String(error))); }
  };
  socket.onerror = () => finish(new TransportError('ElevenLabs dialogue WebSocket error'));
  socket.onclose = (event: CloseEvent) => finish(new TransportError(`ElevenLabs dialogue closed before final audio (${event.code} ${event.reason})`));
});

export const dialogueTtfbPlan = (model: string, voiceId: string, apiKey: string): TtfbPlan => ({
  transport: 'websocket (text-to-dialogue, PCM 24 kHz)',
  notes: `Text to Dialogue WebSocket; single Clara v4 clone ${voiceId}; PCM 24 kHz; English; stability 0.35, similarity 0.95; includes request RTT and excludes connection setup.`,
  trial: () => wsTtfbTrial({
    url: dialogueUrl(model, 'pcm_24000'),
    headers: { 'xi-api-key': apiKey },
    framesFor: () => frames(voiceId, BENCH_TEXT),
    jsonHasAudio: payload => typeof payload.audio === 'string' && decodeBase64Audio(payload.audio).length > 0,
    jsonError: providerError,
  }),
});
