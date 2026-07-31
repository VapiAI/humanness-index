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
import { del, list, put } from '@vercel/blob';

import type { ArenaModelRow } from '../lib/api';
import { VARIANTS, variantsOfModel } from './catalog';
import {
  applyVoteToCounts,
  freshVariantStats,
  type StandingsState,
  type VariantStats,
  type VoteWinner,
} from './elo';
import seedStandings from './seed-standings.json';

const EVENTS_PREFIX = 'humanness/events/';
/**
 * A copy of each vote event, filed under the snapshot generation it landed in.
 * Reading the current counts means replaying the votes recorded since the last
 * snapshot, and finding those by listing EVENTS_PREFIX costs a round trip per
 * 1,000 votes ever cast. Listing one generation of markers instead is a couple
 * of dozen blobs however long the log grows. The event blobs remain the log of
 * record (and the duplicate-vote guard); markers are a disposable index.
 */
const PENDING_PREFIX = 'humanness/pending/';
const SNAPSHOT_PATH = 'humanness/snapshot.json';
const STANDINGS_PATH = 'humanness/standings.json';
/** Roll events into a fresh snapshot every N votes so loads stay fast. */
const SNAPSHOT_INTERVAL = 50;

export type VoteEvent = {
  id: string;
  battleId: string;
  winner: VoteWinner;
  leftVariantId: string;
  rightVariantId: string;
  createdAt: number;
};

type ArenaSnapshot = {
  state: StandingsState;
  totalVotes: number;
};

/**
 * The precomputed Bradley–Terry standings, persisted as a single blob and
 * refreshed in the background on a vote interval. Reading it is O(1) — the
 * heavy all-events fit happens only when this is (re)written, off the request
 * path — so pages, the leaderboard API, pairing, and crowd-judgment all serve
 * from here instead of refitting the whole log per call.
 */
export type StoredStandings = {
  models: ArenaModelRow[];
  /** model id → Bradley–Terry rating (Elo-scale), for pairing + crowd-judgment. */
  ratings: Record<string, number>;
  totalUniqueVotes: number;
  /** ISO timestamp the fit was taken. */
  asOf: string;
};

export class DuplicateVoteError extends Error {}

type ArenaStore = {
  /**
   * Exact variant-level counts + total unique votes: the snapshot plus every
   * vote recorded since it was written. Finding those pending votes means
   * listing the whole event prefix, which costs one round trip per 1,000 votes
   * ever cast — so this is for paths that must not miss a vote.
   */
  load(): Promise<ArenaSnapshot>;
  /**
   * The folded snapshot only, at two blob reads flat however long the log
   * grows. Trails `load` by up to SNAPSHOT_INTERVAL votes, so it suits readers
   * that only need the shape of the standings rather than an exact count.
   */
  loadSnapshotState(): Promise<ArenaSnapshot>;
  /**
   * Append a vote; throws DuplicateVoteError if the battle was already voted.
   * Returns the post-write unique-vote total so the request path doesn't need
   * a second full `load()` just to report the new count.
   */
  recordVote(event: VoteEvent): Promise<{ totalVotes: number }>;
  /**
   * Every recorded vote event, oldest first — the full pairwise log the
   * Bradley–Terry standings fit over. Read-only; never mutates the store.
   */
  loadVoteEvents(): Promise<VoteEvent[]>;
  /**
   * Refold the snapshot from the full event log and put reads on the marker
   * index. Maintenance only (`scripts/migrate-pending-markers.ts`), and
   * idempotent — re-run it to repair a snapshot that has drifted.
   */
  rebuildSnapshot(): Promise<{ totalVotes: number; generation: number }>;
  /** The cached Bradley–Terry standings, or null before the first fit. O(1). */
  loadStandings(): Promise<StoredStandings | null>;
  /** Persist a freshly computed Bradley–Terry fit (background refresh). */
  writeStandings(standings: StoredStandings): Promise<void>;
};

/** Resolve `fn` over `items` with at most `limit` in flight (bounds blob fan-out). */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
};

/**
 * Production standings seed: distribute each model's exported win/loss/tie
 * totals evenly across its variants so the base counts match production
 * exactly; live votes accrue variant-level from there. (The ratings come from
 * the Bradley–Terry fit, which folds these counts as anchor games — see
 * arena.ts; the seed export's per-model Elo is no longer used.)
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
        wins: share(model.wins, index),
        losses: share(model.losses, index),
        ties: share(model.ties, index),
        voteCount: share(model.voteCount, index),
      });
    });
  }
  return { state, totalVotes: seedStandings.totalUniqueVotes };
};

/** Tally one vote into the working counts (replayed deterministically). */
const applyEvent = (state: StandingsState, event: VoteEvent) => {
  const left = state.get(event.leftVariantId);
  const right = state.get(event.rightVariantId);
  if (!left || !right) return;
  const updated = applyVoteToCounts(left, right, event.winner);
  state.set(event.leftVariantId, updated.left);
  state.set(event.rightVariantId, updated.right);
};

/* ------------------------------- Blob store ------------------------------- */

type SnapshotBlob = {
  /** variant id → stats */
  variants: Record<string, VariantStats>;
  /**
   * Battle ids already folded into `variants`. On a pre-marker snapshot this
   * is every battle ever folded; from `generation` onward it only holds the
   * ids folded out of the marker folders, so it stays a few dozen long.
   */
  battleIds: string[];
  totalVotes: number;
  /**
   * Marker folder this snapshot folded through, absent on pre-marker
   * snapshots — which is the signal to fall back to listing the whole event
   * prefix. Written by `scripts/migrate-pending-markers.ts`.
   */
  generation?: number;
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

/**
 * Fetch an IMMUTABLE event blob (vote events never change), with retries so a
 * transient blip never silently drops a vote. No cache-bust — letting the CDN
 * serve these keeps the all-events read (the Bradley-Terry fold) fast.
 */
const fetchEventJson = async <T>(url: string): Promise<T | null> => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (response.ok) return (await response.json()) as T;
    } catch {
      // fall through to retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return null;
};

/**
 * Blob-backed store bound to `token`. Production goes through `arenaStore()`;
 * this is exported so tests can drive the blob paths against a fake backend
 * without depending on process env or the module-level singleton.
 */
export const blobArenaStore = (token: string): ArenaStore => {
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

  const loadStandings = async (): Promise<StoredStandings | null> => {
    const { blobs } = await list({ prefix: STANDINGS_PATH, token, limit: 1 });
    if (blobs.length === 0) return null;
    return fetchJson<StoredStandings>(blobs[0].url);
  };

  const writeStandings = async (standings: StoredStandings) => {
    await put(STANDINGS_PATH, JSON.stringify(standings), {
      access: 'public',
      token,
      contentType: 'application/json',
      allowOverwrite: true,
      addRandomSuffix: false,
      cacheControlMaxAge: 0,
    });
  };

  const listAll = async (prefix: string) => {
    const blobs = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, token, cursor, limit: 1000 });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return blobs;
  };

  const listEventBlobs = () => listAll(EVENTS_PREFIX);

  const markerFolder = (generation: number) => `${PENDING_PREFIX}g${generation}/`;

  /**
   * Every marker a read at `generation` looks through. Two folders, because a
   * vote can be filed against generation N while a roll moves the snapshot to
   * N+1 — so the older folder stays live for exactly one more turn.
   */
  const listMarkers = async (generation: number) =>
    (
      await Promise.all(
        [generation - 1, generation]
          .filter((value) => value >= 1)
          .map((value) => listAll(markerFolder(value))),
      )
    ).flat();

  /**
   * The votes still to replay into `snapshot`, plus the ids a roll should then
   * record as folded — everything visible now, not just the replayed subset,
   * or markers folded by an earlier pass would be replayed a second time.
   *
   * `battleIds` drops whatever the last roll already folded out of those
   * folders. A snapshot written before markers existed has no generation, so
   * it falls back to listing every event ever recorded.
   */
  const pendingWork = async (snapshot: SnapshotBlob | null) => {
    const folded = new Set(snapshot?.battleIds ?? []);
    const listed =
      snapshot?.generation === undefined
        ? await listEventBlobs()
        : await listMarkers(snapshot.generation);
    const seen = new Set<string>();
    const pending = listed.filter((blob) => {
      const battleId = battleIdFromPathname(blob.pathname);
      if (folded.has(battleId) || seen.has(battleId)) return false;
      seen.add(battleId);
      return true;
    });
    return {
      pending,
      foldedAfterRoll: listed.map((blob) => battleIdFromPathname(blob.pathname)),
    };
  };

  /** Fold `blobs` (vote events) into a base state, oldest first. */
  const replay = async (
    base: ArenaSnapshot,
    blobs: { url: string }[],
  ): Promise<ArenaSnapshot> => {
    const events = (
      await Promise.all(blobs.map((blob) => fetchJson<VoteEvent>(blob.url)))
    ).filter((event): event is VoteEvent => event !== null);
    events.sort((a, b) => a.createdAt - b.createdAt);
    for (const event of events) applyEvent(base.state, event);
    return { state: base.state, totalVotes: base.totalVotes + events.length };
  };

  /** Retire marker folders no read will look at again (best effort). */
  const dropMarkers = async (generation: number) => {
    if (generation < 1) return;
    try {
      const stale = await listAll(markerFolder(generation));
      if (stale.length > 0) await del(stale.map((blob) => blob.url), { token });
    } catch (error) {
      console.warn('[humanness] dropping stale vote markers failed:', error);
    }
  };

  /** The folded snapshot as working counts (no pending replay). */
  const foldedState = (snapshot: SnapshotBlob | null): ArenaSnapshot => {
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
    return { state, totalVotes: snapshot?.totalVotes ?? seeded.totalVotes };
  };

  const loadSnapshotState = async (): Promise<ArenaSnapshot> =>
    foldedState(await loadSnapshot());

  const load = async (): Promise<ArenaSnapshot> => {
    const snapshot = await loadSnapshot();
    const { pending } = await pendingWork(snapshot);
    return replay(foldedState(snapshot), pending);
  };

  const readAllEvents = async (concurrency: number): Promise<VoteEvent[]> => {
    const eventBlobs = await listEventBlobs();
    const events = (
      await mapWithConcurrency(eventBlobs, concurrency, (blob) =>
        fetchEventJson<VoteEvent>(blob.url),
      )
    ).filter((event): event is VoteEvent => event !== null);
    events.sort((a, b) => a.createdAt - b.createdAt);
    return events;
  };

  // Vercel Blob is CDN-backed and handles high read concurrency, so fan out
  // wide to keep the full-log read well under the prerender cache timeout.
  const loadVoteEvents = () => readAllEvents(400);

  return {
    load,
    loadSnapshotState,
    loadVoteEvents,
    loadStandings,
    writeStandings,
    async rebuildSnapshot() {
      // Advance the sequence rather than resetting it: votes in flight file
      // markers under the CURRENT generation, and a read at the next one still
      // looks through that folder, so a rebuild can't strand them.
      const generation = ((await loadSnapshot())?.generation ?? 0) + 1;
      // Deliberately gentler than the request-path read: this is offline
      // maintenance with no timeout budget, and a burst of thousands of blob
      // reads from one client can trip Vercel's automatic DDoS mitigation
      // (which then 403s public reads, audio clips included).
      const events = await readAllEvents(25);
      const { state, totalVotes: seedVotes } = foldedState(null);
      for (const event of events) applyEvent(state, event);
      const foldedIds = new Set(events.map((event) => event.battleId));
      // Listed AFTER the fold: a marker written mid-rebuild is only recorded as
      // folded if its event actually made it into the counts above.
      const markers = await listMarkers(generation);
      await writeSnapshot({
        variants: Object.fromEntries(state),
        battleIds: markers
          .map((blob) => battleIdFromPathname(blob.pathname))
          .filter((battleId) => foldedIds.has(battleId)),
        totalVotes: seedVotes + events.length,
        generation,
      });
      return { totalVotes: seedVotes + events.length, generation };
    },
    async recordVote(event) {
      const snapshot = await loadSnapshot();
      // The event blob is the log of record AND the duplicate guard: one battle
      // maps to one immutable path, so a second vote loses the write outright.
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
      // Then the marker reads find this vote through, in the generation the
      // snapshot is currently on. Overwritable, so a retry is harmless.
      const generation = snapshot?.generation ?? 1;
      await put(
        `${markerFolder(generation)}${event.battleId}.json`,
        JSON.stringify(event),
        {
          access: 'public',
          token,
          contentType: 'application/json',
          allowOverwrite: true,
          addRandomSuffix: false,
          cacheControlMaxAge: 0,
        },
      );

      const { pending, foldedAfterRoll } = await pendingWork(snapshot);
      const { state, totalVotes } = await replay(foldedState(snapshot), pending);
      // Opportunistically refresh the snapshot so loads don't replay forever.
      if (totalVotes % SNAPSHOT_INTERVAL === 0) {
        await writeSnapshot({
          variants: Object.fromEntries(state),
          battleIds: foldedAfterRoll,
          totalVotes,
          // A pre-marker store keeps rolling the old way until the migration
          // script switches reads onto the markers.
          ...(snapshot?.generation === undefined
            ? {}
            : { generation: generation + 1 }),
        });
        // The folder before the one just folded is out of every read's reach.
        if (snapshot?.generation !== undefined) await dropMarkers(generation - 1);
      }
      return { totalVotes };
    },
  };
};

/** `humanness/events/battle:ab.json` → `battle:ab` (markers share the shape). */
const battleIdFromPathname = (pathname: string): string =>
  pathname.slice(pathname.lastIndexOf('/') + 1).replace(/\.json$/, '');

/* ----------------------------- In-memory store ---------------------------- */

const memoryStore = (): ArenaStore => {
  const seeded = seededState();
  const state = seeded.state;
  let totalVotes = seeded.totalVotes;
  const votedBattles = new Set<string>();
  // The seed export carries no pairwise detail, so the live log starts empty;
  // it grows as votes come in (mirrors the blob store's event blobs).
  const events: VoteEvent[] = [];
  let standings: StoredStandings | null = null;

  const snapshot = async () => ({
    state: new Map([...state.entries()].map(([id, stats]) => [id, { ...stats }])),
    totalVotes,
  });

  return {
    load: snapshot,
    // Nothing is deferred in memory, so the cheap read is the exact one.
    loadSnapshotState: snapshot,
    async loadVoteEvents() {
      return [...events];
    },
    async loadStandings() {
      return standings;
    },
    // Nothing is deferred in memory, so there is no snapshot to refold.
    async rebuildSnapshot() {
      return { totalVotes, generation: 1 };
    },
    async writeStandings(next) {
      standings = next;
    },
    async recordVote(event) {
      if (votedBattles.has(event.battleId)) {
        throw new DuplicateVoteError('Battle has already been voted on');
      }
      votedBattles.add(event.battleId);
      applyEvent(state, event);
      events.push(event);
      totalVotes += 1;
      return { totalVotes };
    },
  };
};

/* --------------------------------- Factory -------------------------------- */

let store: ArenaStore | null = null;

export const arenaStore = (): ArenaStore => {
  if (store) return store;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    store = blobArenaStore(token);
  } else {
    console.warn(
      '[humanness] BLOB_READ_WRITE_TOKEN not set; using in-memory arena store (votes reset on restart).',
    );
    store = memoryStore();
  }
  return store;
};
