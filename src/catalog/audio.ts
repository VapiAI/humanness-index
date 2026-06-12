import type { FallbackClip } from './types';

/**
 * The hosted clip origin: this project's Vercel Blob store, where every
 * (variant x prompt) arena clip lives as audio/{contentHash}.mp3. The server
 * honors a HUMANNESS_AUDIO_ORIGIN env override (see server/catalog.ts);
 * client-side fallbacks use this constant directly. Client-safe: no node
 * builtins.
 */
export const ARENA_AUDIO_ORIGIN =
  'https://bkvlbh5qphzaen1w.public.blob.vercel-storage.com';

/** Absolute URL for a pinned fallback clip. */
export const arenaClipUrl = (clip: Pick<FallbackClip, 'path'>): string =>
  `${ARENA_AUDIO_ORIGIN}${clip.path}`;

/**
 * A pinned clip from its frozen identity plus its content hash. catalog.test
 * recomputes the hash from (variantId, promptId) and asserts it reproduces
 * `path`, so pins stay derivations of the ids rather than free-floating URLs.
 */
export const pinnedClip = (
  voiceId: string,
  providerId: string,
  arenaApiId: string,
  promptId: string,
  hash: string,
): FallbackClip => ({
  variantId: `variant:${voiceId}:${providerId}:${arenaApiId}`,
  promptId,
  path: `/audio/${hash}.mp3`,
});
