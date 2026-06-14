/**
 * Arena persistence — Vercel Blob, event-sourced (the model the original
 * prototype ran in production). The catalog is code (catalog.ts); only votes
 * persist:
 *
 *   humanness/events/{battleId}.json   one immutable blob per vote (append-only)
 *   humanness/snapshot.json            periodic full-state rollup (read cache)
 *
 * Each vote is written under its battle id with `allowOverwrite: false`, so a
 * battle can only ever be voted once (idempotency + no lost writes), and the
 * authoritative standings are a deterministic fold of the event set over the
 * production seed — concurrency-safe without locks.
 *
 * `BLOB_READ_WRITE_TOKEN` is injected by the connected Blob store in prod;
 * without it (local dev) an in-memory store seeded the same way is used.
 */
import { list, put } from '@vercel/blob';

import { VARIANTS, variantsOfModel } from './catalog';
import {
  applyVoteToStats,
  freshVariantStats,
  INITIAL_ELO,
  type StandingsState,
  type VariantStats,
  type VoteWinner,
} from './elo';
import seedStandings from './seed-standings.json';

const EVENTS_PREFIX = 'humanness/events/';
const SNAPSHOT_PATH = 'humanness/snapshot.json';
/** Roll events into a fresh snapshot every N votes so loads stay fast. */
const SNAPSHOT_INTERVAL = 50;

export type VoteEvent = {
  id: string;
  battleId: string;
  winner: VoteWinner;
  leftVariantId: string;
  rightVariantId: string;
  /** Pre/post Elo are kept for audit; replay recomputes from winner + ids. */
  leftEloBefore: number;
  rightEloBefore: number;
  leftEloAfter: number;
  rightEloAfter: number;
  createdAt: number;
};

type ArenaSnapshot = {
  state: StandingsState;
  totalVotes: number;
};

export class DuplicateVoteError extends Error {}

type ArenaStore = {
  /** Current standings + total unique votes. */
  load(): Promise<ArenaSnapshot>;
  /** Append a vote; throws DuplicateVoteError if the battle was already voted. */
  recordVote(event: VoteEvent): Promise<void>;
};

/**
 * Production standings seed: distribute each model's exported aggregates
 * (mean Elo, summed counts) evenly across its variants so the base state
 * matches production exactly; live votes evolve variant-level from there.
 */
const seededState = (): ArenaSnapshot => {
  const state: StandingsState = new Map(
    VARIANTS.map((variant) => [variant.id, freshVariantStats()]),
  );
  for (const model of seedStandings.models) {
    const variants = variantsOfModel(model.id);
    if (variants.length === 0) continue;
    const share = (value: number, index: number) =>
      Math.floor(value / variants.length) + (index < value % variants.length ? 1 : 0);
    variants.forEach((variant, index) => {
      state.set(variant.id, {
        elo: model.elo ?? INITIAL_ELO,
        wins: share(model.wins, index),
        losses: share(model.losses, index),
        ties: share(model.ties, index),
        voteCount: share(model.voteCount, index),
      });
    });
  }
  return { state, totalVotes: seedStandings.totalUniqueVotes };
};

/** Replay one vote onto the working state (recompute, don't trust stored Elo). */
const applyEvent = (state: StandingsState, event: VoteEvent) => {
  const left = state.get(event.leftVariantId);
  const right = state.get(event.rightVariantId);
  if (!left || !right) return;
  const updated = applyVoteToStats(left, right, event.winner);
  state.set(event.leftVariantId, updated.left);
  state.set(event.rightVariantId, updated.right);
};

/* ------------------------------- Blob store ------------------------------- */

type SnapshotBlob = {
  /** variant id → stats */
  variants: Record<string, VariantStats>;
  /** battle ids already folded into `variants`. */
  battleIds: string[];
  totalVotes: number;
};

const fetchJson = async <T>(url: string): Promise<T | null> => {
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const blobStore = (token: string): ArenaStore => {
  const loadSnapshot = async (): Promise<SnapshotBlob | null> => {
    const { blobs } = await list({ prefix: SNAPSHOT_PATH, token, limit: 1 });
    if (blobs.length === 0) return null;
    return fetchJson<SnapshotBlob>(blobs[0].url);
  };

  const writeSnapshot = async (snapshot: SnapshotBlob) => {
    await put(SNAPSHOT_PATH, JSON.stringify(snapshot), {
      access: 'public',
      token,
      contentType: 'application/json',
      allowOverwrite: true,
      addRandomSuffix: false,
      cacheControlMaxAge: 0,
    });
  };

  const listEventBlobs = async () => {
    const blobs = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: EVENTS_PREFIX, token, cursor, limit: 1000 });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return blobs;
  };

  const load = async (): Promise<ArenaSnapshot> => {
    const snapshot = await loadSnapshot();
    const seeded = seededState();
    const state: StandingsState = snapshot
      ? new Map(
          VARIANTS.map((variant) => [
            variant.id,
            // A snapshot predates any model added after it was written, so fall
            // back to the production seed (e.g. the Human baseline's anchor
            // Elo) before a blank row, so newly seeded entries don't reset to
            // the default Elo on a store that already has a snapshot.
            snapshot.variants[variant.id] ??
              seeded.state.get(variant.id) ??
              freshVariantStats(),
          ]),
        )
      : seeded.state;
    const includedBattles = new Set(snapshot?.battleIds ?? []);

    const eventBlobs = await listEventBlobs();
    const pending = eventBlobs.filter(
      (blob) => !includedBattles.has(battleIdFromPathname(blob.pathname)),
    );
    const events = (
      await Promise.all(pending.map((blob) => fetchJson<VoteEvent>(blob.url)))
    ).filter((event): event is VoteEvent => event !== null);
    events.sort((a, b) => a.createdAt - b.createdAt);
    for (const event of events) applyEvent(state, event);

    const baseVotes = snapshot?.totalVotes ?? seeded.totalVotes;
    return { state, totalVotes: baseVotes + events.length };
  };

  return {
    load,
    async recordVote(event) {
      try {
        await put(`${EVENTS_PREFIX}${event.battleId}.json`, JSON.stringify(event), {
          access: 'public',
          token,
          contentType: 'application/json',
          allowOverwrite: false,
          addRandomSuffix: false,
          cacheControlMaxAge: 31536000,
        });
      } catch (error) {
        if (error instanceof Error && /exists|409|overwrite/i.test(error.message)) {
          throw new DuplicateVoteError('Battle has already been voted on');
        }
        throw error;
      }
      // Opportunistically refresh the snapshot so loads don't replay forever.
      const { state, totalVotes } = await load();
      if (totalVotes % SNAPSHOT_INTERVAL === 0) {
        const eventBlobs = await listEventBlobs();
        await writeSnapshot({
          variants: Object.fromEntries(state),
          battleIds: eventBlobs.map((blob) => battleIdFromPathname(blob.pathname)),
          totalVotes,
        });
      }
    },
  };
};

const battleIdFromPathname = (pathname: string): string =>
  pathname.replace(EVENTS_PREFIX, '').replace(/\.json$/, '');

/* ----------------------------- In-memory store ---------------------------- */

const memoryStore = (): ArenaStore => {
  const seeded = seededState();
  const state = seeded.state;
  let totalVotes = seeded.totalVotes;
  const votedBattles = new Set<string>();

  return {
    async load() {
      return {
        state: new Map([...state.entries()].map(([id, stats]) => [id, { ...stats }])),
        totalVotes,
      };
    },
    async recordVote(event) {
      if (votedBattles.has(event.battleId)) {
        throw new DuplicateVoteError('Battle has already been voted on');
      }
      votedBattles.add(event.battleId);
      applyEvent(state, event);
      totalVotes += 1;
    },
  };
};

/* --------------------------------- Factory -------------------------------- */

let store: ArenaStore | null = null;

export const arenaStore = (): ArenaStore => {
  if (store) return store;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    store = blobStore(token);
  } else {
    console.warn(
      '[humanness] BLOB_READ_WRITE_TOKEN not set; using in-memory arena store (votes reset on restart).',
    );
    store = memoryStore();
  }
  return store;
};
