/**
 * Shared pipeline primitives: the arena's frozen content-hash scheme and the
 * clip addressing helpers every other pipeline script builds on.
 *
 * The hash MUST stay byte-identical to server/catalog.ts#audioUrlFor
 * (the original prototype's static-audio naming scheme): any drift orphans
 * the hosted MP3s. catalog.test.ts pins golden hashes on the server side;
 * this module is the generation-side twin.
 */
import { createHash } from 'node:crypto';

import { ARENA_AUDIO_ORIGIN } from '../catalog/audio';

/** Frozen settings-version hash segment (matches server/catalog.ts). */
const AUDIO_GENERATION_VERSION = 'settings-v3';

/** `variant:{voiceId}:{providerId}:{arenaApiId}` — frozen id scheme. */
export const variantIdFor = (
  voiceId: string,
  providerId: string,
  arenaApiId: string,
): string => `variant:${voiceId}:${providerId}:${arenaApiId}`;

/** 32-hex-char content hash addressing a hosted clip. */
export const clipHash = (variantId: string, promptId: string): string =>
  createHash('sha256')
    .update(`${variantId}|${promptId}|${AUDIO_GENERATION_VERSION}`)
    .digest('hex')
    .slice(0, 32);

/**
 * The single MP3 encoding every hosted arena clip must share.
 *
 * Providers return their own sample rates and bitrates, and a battle that
 * serves them verbatim leaks the model in the MP3 frame header: four bytes were
 * once enough to name Grok TTS (Streaming) outright and cut MiniMax, Inworld
 * and others down to a two- or three-way guess, without listening. Anything
 * that writes a clip encodes to exactly this, so the header stays silent — and
 * so no model gets a bitrate edge over the field.
 */
export const ARENA_CLIP_FORMAT = {
  sampleRate: 44_100,
  bitrateKbps: 128,
  channels: 1,
} as const;

/** ffmpeg output args pinning a clip to `ARENA_CLIP_FORMAT`. */
export const arenaEncodeArgs = (): string[] => [
  '-ac',
  String(ARENA_CLIP_FORMAT.channels),
  '-ar',
  String(ARENA_CLIP_FORMAT.sampleRate),
  '-c:a',
  'libmp3lame',
  '-b:a',
  `${ARENA_CLIP_FORMAT.bitrateKbps}k`,
];

/** Blob store pathname for a clip hash. */
export const clipBlobPathname = (hash: string): string => `audio/${hash}.mp3`;

/** Public URL for a clip hash on the arena audio origin. */
export const clipPublicUrl = (hash: string): string =>
  `${ARENA_AUDIO_ORIGIN}/audio/${hash}.mp3`;

/** True when the buffer starts like an MP3 stream (ID3 tag or frame sync). */
export const looksLikeMp3 = (bytes: Uint8Array): boolean => {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // 'ID3'
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0; // frame sync
};

/** Tiny arg parser: positionals + --flag / --key value pairs. */
export const parseArgs = (
  argv: string[],
): { positionals: string[]; flags: Map<string, string | true> } => {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(name, next);
        i += 1;
      } else {
        flags.set(name, true);
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
};

export const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const stdev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
