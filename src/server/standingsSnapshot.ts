/**
 * Hourly standings snapshot for the detail pages.
 *
 * The repo enforces Next 16 `cacheComponents`, so freshness is expressed as a
 * cached server function (`'use cache'` + the `'hours'` cacheLife profile)
 * rather than a `revalidate` segment config: the RSC shell calls the arena
 * service directly (no HTTP hop) and bakes rank/Humanness into crawlable
 * HTML at most an hour stale; the `LiveStandings` client islands reconcile
 * against /api/models on mount.
 */
import 'server-only';

import { cacheLife } from 'next/cache';

import type { ArenaModelRow } from '../lib/api';
import { getModels } from './arena';
import { audioUrlFor } from './catalog';

export type StandingsSnapshot = {
  models: ArenaModelRow[];
  totalUniqueVotes: number;
  /** ISO timestamp the snapshot was taken (drives the "as of" label). */
  asOf: string;
};

export const getStandingsSnapshot = async (): Promise<StandingsSnapshot> => {
  'use cache';
  cacheLife('hours');
  const { models, totalUniqueVotes } = await getModels();
  return { models, totalUniqueVotes, asOf: new Date().toISOString() };
};

/** Every static sample reads the same warm, mid-call support prompt. */
const STATIC_SAMPLE_PROMPT_ID = 'clip-04';
const STATIC_SAMPLE_VOICE_ID = 'voice-clara';

/**
 * Deterministic hosted clip for a model (one fixed voice and prompt across
 * the field, so pages stay comparable), precomputed server-side so the page
 * has playable audio before hydration and without JS; the sample island
 * upgrades to a random live clip on play.
 */
export const staticSampleUrlFor = (model: {
  providerId: string;
  arenaApiId: string;
}): string =>
  audioUrlFor(
    `variant:${STATIC_SAMPLE_VOICE_ID}:${model.providerId}:${model.arenaApiId}`,
    STATIC_SAMPLE_PROMPT_ID,
  );
