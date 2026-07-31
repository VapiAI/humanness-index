/// <reference types="bun" />
/**
 * The blob-backed store against a fake blob backend: the marker index is the
 * part that decides which votes get replayed, so its generation rules are
 * worth exercising rather than trusting to the memory store (which defers
 * nothing and so can't express them).
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';

import { variantsOfModel } from './catalog';
import seedStandings from './seed-standings.json';
import { blobArenaStore, type VoteEvent } from './store';

/** Votes the seed export already accounts for, before any live vote lands. */
const SEED_TOTAL = seedStandings.totalUniqueVotes;

const ORIGIN = 'https://blob.test/';

/** pathname → body, standing in for the blob store. */
const backend = new Map<string, string>();
let listedPrefixes: string[] = [];

/** One-shot hook fired just after the event log is listed (see the rebuild test). */
let onEventsListed: (() => void) | null = null;

mock.module('@vercel/blob', () => ({
  list: async ({ prefix }: { prefix: string }) => {
    listedPrefixes.push(prefix);
    const page = {
      blobs: [...backend.keys()]
        .filter((pathname) => pathname.startsWith(prefix))
        .map((pathname) => ({ pathname, url: `${ORIGIN}${pathname}` })),
      hasMore: false,
    };
    if (prefix === 'humanness/events/' && onEventsListed) {
      const fire = onEventsListed;
      onEventsListed = null;
      fire();
    }
    return page;
  },
  put: async (
    pathname: string,
    body: string,
    options: { allowOverwrite?: boolean },
  ) => {
    if (options.allowOverwrite === false && backend.has(pathname)) {
      throw new Error('This blob already exists');
    }
    backend.set(pathname, body);
    return { pathname, url: `${ORIGIN}${pathname}` };
  },
  del: async (urls: string | string[]) => {
    for (const url of [urls].flat()) backend.delete(url.replace(ORIGIN, ''));
  },
}));

/** Blob reads are plain HTTP GETs against the fake backend's urls. */
const backendFetch = (async (input: RequestInfo | URL) => {
  const pathname = decodeURIComponent(new URL(String(input)).pathname.slice(1));
  const body = backend.get(pathname);
  return body === undefined
    ? new Response('not found', { status: 404 })
    : new Response(body, { status: 200 });
}) as typeof fetch;

const realFetch = globalThis.fetch;
// Built directly rather than through `arenaStore()`: the singleton latches onto
// whichever store the first test file in the run asked for.
const store = blobArenaStore('test-token');

const left = variantsOfModel('inworld-tts-2')[0];
const right = variantsOfModel('cartesia-sonic-2')[0];
let nextBattle = 0;

const vote = (): VoteEvent => {
  nextBattle += 1;
  return {
    id: `vote:${nextBattle}`,
    battleId: `battle:${nextBattle}`,
    winner: 'left',
    leftVariantId: left.id,
    rightVariantId: right.id,
    createdAt: 1_700_000_000_000 + nextBattle,
  };
};

/** Write a vote straight to the backend the way `recordVote` does: log, then marker. */
const file = (event: VoteEvent, generation: number) => {
  backend.set(`humanness/events/${event.battleId}.json`, JSON.stringify(event));
  backend.set(
    `humanness/pending/g${generation}/${event.battleId}.json`,
    JSON.stringify(event),
  );
};

const snapshotBlob = () =>
  JSON.parse(backend.get('humanness/snapshot.json')!) as {
    battleIds: string[];
    totalVotes: number;
    generation?: number;
  };

/** Record votes until the next snapshot roll lands (at least one). */
const voteToRoll = async (from: number) => {
  let total = from;
  do {
    await store.recordVote(vote());
    total += 1;
  } while (total % 50 !== 0);
};

beforeAll(() => {
  globalThis.fetch = backendFetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('blob store: marker index', () => {
  it('reads through the whole event log until a snapshot names a generation', async () => {
    const before = await store.load();
    await store.recordVote(vote());
    const after = await store.load();
    expect(after.totalVotes).toBe(before.totalVotes + 1);
    // The vote is filed twice: the event log of record, plus its marker.
    expect(backend.has('humanness/events/battle:1.json')).toBe(true);
    expect(backend.has('humanness/pending/g1/battle:1.json')).toBe(true);
    // No generation yet, so the read still walks the event prefix.
    expect(listedPrefixes).toContain('humanness/events/');
  });

  it('stops listing the event log once the snapshot is rebuilt onto markers', async () => {
    const rebuilt = await store.rebuildSnapshot();
    expect(rebuilt.generation).toBe(1);
    expect(snapshotBlob().generation).toBe(1);
    // The vote above is folded into the rebuild, so its marker must be skipped.
    expect(snapshotBlob().battleIds).toEqual(['battle:1']);

    listedPrefixes = [];
    const loaded = await store.load();
    expect(loaded.totalVotes).toBe(rebuilt.totalVotes);
    expect(listedPrefixes).not.toContain('humanness/events/');
    expect(listedPrefixes).toContain('humanness/pending/g1/');
  });

  it('rolls to the next generation and keeps the count exact across it', async () => {
    const start = (await store.load()).totalVotes;
    await voteToRoll(start);
    const rolled = snapshotBlob();
    expect(rolled.totalVotes % 50).toBe(0);
    expect(rolled.generation).toBe(2);
    expect((await store.load()).totalVotes).toBe(rolled.totalVotes);
  });

  it('prunes the folder two generations back without losing a vote', async () => {
    const start = (await store.load()).totalVotes;
    await voteToRoll(start);
    expect(snapshotBlob().generation).toBe(3);
    // g1 is now out of reach of both listed folders, so it is cleared.
    expect([...backend.keys()].some((p) => p.startsWith('humanness/pending/g1/'))).toBe(
      false,
    );
    // Recount from the log of record: no vote was dropped or double counted.
    const events = [...backend.keys()].filter((p) => p.startsWith('humanness/events/'));
    const loaded = await store.load();
    expect(loaded.totalVotes).toBe(SEED_TOTAL + events.length);
  });

  it('replays a vote filed against the previous generation mid-roll', async () => {
    const before = await store.load();
    // A vote that read the old generation while a roll moved the snapshot on;
    // as on the real path, the event blob is written before the marker.
    const straggler = vote();
    file(straggler, snapshotBlob().generation! - 1);
    expect((await store.load()).totalVotes).toBe(before.totalVotes + 1);
  });

  it('rebuilds onto the next generation without stranding a vote that lands mid-rebuild', async () => {
    const before = await store.load();
    // Lands after the rebuild has listed the log, so only its marker can
    // account for it — exactly what a rebuild must not age out.
    const late = vote();
    onEventsListed = () => file(late, snapshotBlob().generation!);

    const rebuilt = await store.rebuildSnapshot();
    expect(rebuilt.generation).toBeGreaterThan(1); // continues, doesn't reset
    expect((await store.load()).totalVotes).toBe(before.totalVotes + 1);
  });

  it('still rejects a repeat vote on a battle folded in an earlier generation', async () => {
    const first = vote();
    await store.recordVote(first);
    const votedIn = snapshotBlob().generation!;
    await voteToRoll((await store.load()).totalVotes);
    expect(snapshotBlob().generation!).toBeGreaterThan(votedIn);
    await expect(
      store.recordVote({ ...first, id: 'vote:repeat', winner: 'right' }),
    ).rejects.toThrow(/already been voted/);
  });
});
