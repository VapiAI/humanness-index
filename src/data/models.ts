import { modelEntryById, providerOfModel } from '../catalog';
import type { ArenaModelRow } from '../lib/api';
import type { ArenaRow } from '../lib/types';
import { SEED_STANDINGS } from './seedStandings';

/**
 * Unique-vote total at the time of the production export (server/
 * seed-standings.json). Shown for first paint, replaced by the live count
 * from GET /api/models.
 */
export const SEED_TOTAL_UNIQUE_VOTES: number = SEED_STANDINGS.totalUniqueVotes;

/** Standard error of an Elo estimate after n votes (matches server/elo.ts). */
const seedUncertainty = (voteCount: number) =>
  Math.round(160 / Math.sqrt(Math.max(1, voteCount)));

/**
 * Static first-paint snapshot of the arena standings: the 2026-06-10
 * production export (data/seedStandings.ts, in standings order) joined with
 * registry identity — display names, the frozen `seedLikelyRank` label, and
 * the `voiceProfile` seed for each model's visualizer fingerprint. Unlisted
 * registry entries (and any seed row without a registry entry) are filtered
 * out; the live leaderboard replaces all of it on mount.
 */
export const ARENA_ROWS: ArenaRow[] = SEED_STANDINGS.models.flatMap((seed) => {
  const entry = modelEntryById(seed.id);
  if (!entry || entry.status === 'unlisted') return [];
  return [
    {
      id: entry.id,
      provider: providerOfModel(entry).name,
      model: entry.name,
      elo: Math.round(seed.elo),
      uncertainty: seedUncertainty(seed.voteCount),
      wins: seed.wins,
      losses: seed.losses,
      ties: seed.ties,
      // Presence for every listed seeded model is enforced by catalog.test.
      likelyRank: entry.seedLikelyRank!,
      voiceProfile: entry.voiceProfile,
    },
  ];
});

const ARENA_ROWS_BY_ID = new Map(ARENA_ROWS.map((row) => [row.id, row]));

/**
 * Merge live leaderboard rows with the static presentation data
 * (`voiceProfile` drives each model's visualizer fingerprint and must stay
 * stable across refreshes). Models that arrive live without a seed row
 * (added to the registry but not the export) still get their registry
 * fingerprint; rows unknown to the registry fall back to list position.
 */
export const mergeStandings = (rows: ArenaModelRow[]): ArenaRow[] =>
  rows.map((row, index) => ({
    id: row.id,
    provider: row.provider,
    model: row.model,
    elo: row.elo,
    uncertainty: row.uncertainty,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    likelyRank: row.rankRange,
    voiceProfile:
      ARENA_ROWS_BY_ID.get(row.id)?.voiceProfile ??
      modelEntryById(row.id)?.voiceProfile ??
      index + 1,
  }));
