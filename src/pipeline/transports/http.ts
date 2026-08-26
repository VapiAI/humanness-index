/**
 * Shared HTTP/WS plumbing for the provider transports: JSON/binary fetch
 * wrappers with status handling, hex/base64 audio decoding (ported from
 * the original prototype's flexible audio-result helpers), a streamed
 * first-chunk TTFB trial, and a WebSocket TTFB trial.
 */
import { RateLimitedError, TransportError, type TtfbTrialResult } from './types';

const TIMEOUT_MS = 60_000;

/** Throws TransportError (or RateLimitedError on 429) for non-2xx responses. */
export const throwForStatus = async (response: Response, label: string): Promise<void> => {
  if (response.ok) return;
  const detail = (await response.text()).slice(0, 300);
  const error =
    response.status === 429
      ? new RateLimitedError(`${label} returned HTTP 429: ${detail}`)
      : new TransportError(`${label} returned HTTP ${response.status}: ${detail}`);
  throw error;
};

export const postJsonForBytes = async (
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  label: string,
): Promise<Uint8Array> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await throwForStatus(response, label);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new TransportError(`${label} returned empty audio`);
  return bytes;
};

export const requestJson = async <T>(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  label: string,
): Promise<T> => {
  const response = await fetch(url, {
    method,
    headers:
      payload === undefined
        ? headers
        : { 'content-type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await throwForStatus(response, label);
  return (await response.json()) as T;
};

export const postFormForJson = async <T>(
  url: string,
  headers: Record<string, string>,
  form: FormData,
  label: string,
): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS * 3),
  });
  await throwForStatus(response, label);
  return (await response.json()) as T;
};

export const decodeHexAudio = (hex: string): Uint8Array => {
  const compact = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(compact.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

export const decodeBase64Audio = (base64: string): Uint8Array =>
  new Uint8Array(Buffer.from(base64.replace(/\s+/g, ''), 'base64'));

/* --------------------------------- TTFB ---------------------------------- */

/** The bench sentence (12 words) — same as the original prototype's bench. */
export const BENCH_TEXT =
  'Okay, let me pull up your account details right now for you.';

/**
 * Streamed HTTP trial: t0 right before the request is dispatched, t1 when
 * the accumulated body satisfies `audioMarker`. The body is drained fully so
 * keep-alive connections stay reusable; warm-up trials absorb connection
 * setup (mirrors the pre-established-connection methodology of the
 * original bench — connectMs is folded into warm-ups, reported as 0).
 */
export const httpStreamTrial = async (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
  audioMarker: (buffer: Uint8Array, length: number) => boolean,
  timeoutMs = 30_000,
): Promise<TtfbTrialResult> => {
  const t0 = performance.now();
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  await throwForStatus(response, 'stream trial');
  if (!response.body) throw new TransportError('no response body');
  const reader = response.body.getReader();
  let t1: number | null = null;
  let buffer = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    const now = performance.now();
    if (done) break;
    if (value && value.length > 0) {
      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer);
      merged.set(value, buffer.length);
      buffer = merged;
      if (t1 === null && audioMarker(buffer, buffer.length)) {
        t1 = now;
      }
    }
  }
  if (t1 === null) {
    throw new TransportError(
      `no audio found in response body (${buffer.length} bytes)`,
    );
  }
  return { ttfbMs: t1 - t0, connectMs: 0 };
};

/** Marker: any non-empty body byte counts as audio (binary streams). */
export const anyBytesMarker = (_buffer: Uint8Array, length: number): boolean =>
  length > 0;

/** Marker: an SSE/JSON event carrying a non-empty `"audio":"…"` value. */
export const audioJsonFieldMarker = (
  buffer: Uint8Array,
  length: number,
): boolean => {
  const needle = '"audio":"';
  const text = new TextDecoder().decode(buffer);
  const index = text.indexOf(needle);
  return index !== -1 && length > index + needle.length + 3;
};

type WsTrialSpec = {
  url: string;
  headers?: Record<string, string>;
  /** Frames sent after the socket opens; t0 is taken before the first send. */
  framesFor: () => string[];
  /** Returns true when a parsed JSON payload carries audio. */
  jsonHasAudio: (payload: Record<string, unknown>) => boolean;
  /** Returns an error string when a payload is a provider error. */
  jsonError?: (payload: Record<string, unknown>) => string | null;
  timeoutMs?: number;
};

/**
 * WebSocket trial: connection established (connectMs) before t0; t0 at the
 * first frame send; t1 at the first message carrying audio. Mirrors the
 * original prototype's 50-trial bench.
 */
export const wsTtfbTrial = (spec: WsTrialSpec): Promise<TtfbTrialResult> =>
  new Promise((resolve, reject) => {
    const timeoutMs = spec.timeoutMs ?? 30_000;
    const tConnect = performance.now();
    // Bun's WebSocket accepts an options object with custom headers; the DOM
    // type signature does not know it, hence the cast.
    const ws = new WebSocket(
      spec.url,
      (spec.headers ? { headers: spec.headers } : undefined) as unknown as
        | string[]
        | undefined,
    );
    ws.binaryType = 'arraybuffer';
    let settled = false;
    let t0 = 0;
    const timer = setTimeout(() => {
      finish(() => reject(new TransportError('no audio within timeout')));
    }, timeoutMs);
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      settle();
    };
    ws.onopen = () => {
      const connectMs = performance.now() - tConnect;
      t0 = performance.now();
      try {
        for (const frame of spec.framesFor()) ws.send(frame);
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      ws.onmessage = (event: MessageEvent) => {
        const now = performance.now();
        const data: unknown = event.data;
        if (typeof data !== 'string') {
          // Binary frame = audio.
          if (data instanceof ArrayBuffer && data.byteLength > 0) {
            finish(() => resolve({ ttfbMs: now - t0, connectMs }));
          }
          return;
        }
        if (!data) return;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(data) as Record<string, unknown>;
        } catch {
          return;
        }
        const errorText = spec.jsonError?.(payload);
        if (errorText) {
          const rateLimited = errorText.includes('429');
          finish(() =>
            reject(
              rateLimited
                ? new RateLimitedError(errorText)
                : new TransportError(`provider error: ${errorText.slice(0, 300)}`),
            ),
          );
          return;
        }
        if (spec.jsonHasAudio(payload)) {
          finish(() => resolve({ ttfbMs: now - t0, connectMs }));
        }
      };
    };
    ws.onerror = () => {
      finish(() => reject(new TransportError('websocket error')));
    };
    ws.onclose = (event: CloseEvent) => {
      finish(() =>
        reject(
          new TransportError(
            `websocket closed before audio (code ${event.code} ${event.reason})`.trim(),
          ),
        ),
      );
    };
  });
