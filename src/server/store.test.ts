/// <reference types="bun" />
import { describe, expect, it } from 'bun:test';

import { randomUUID } from 'node:crypto';

import { VARIANTS, variantsOfModel } from './catalog';
import seedStandings from './seed-standings.json';
import { arenaStore, DuplicateVoteError, type VoteEvent } from './store';

// Hermetic: force the in-memory store fallback (never touch Vercel Blob).
delete process.env.BLOB_READ_WRITE_TOKEN;

/**
 * Models reserved for the seed-fidelity assertions below. No test in this
 * suite (this file, arena.test.ts, or routes.test.ts) ever votes on them, so
 * their stats must still equal the production seed regardless of test order.
 */
const SEED_RESERVED_MODELS = ['gradium-gradium-tts', 'minimax-minimax-tts'];

const voteEvent = (overrides: Partial<VoteEvent> = {}): VoteEvent => ({
  id: `vote:${randomUUID().replaceAll('-', '')}`,
  battleId: `battle:${randomUUID().replaceAll('-', '')}`,
  winner: 'left',
  leftVariantId: variantsOfModel('inworld-tts-2')[0].id,
  rightVariantId: variantsOfModel('elevenlabs-flash-v2')[0].id,
  createdAt: Date.now(),
  ...overrides,
});

describe('arenaStore (in-memory fallback)', () => {
  it('is a singleton — votes recorded through one handle are visible to the next', () => {
    expect(arenaStore()).toBe(arenaStore());
  });

  it('works fully offline: load and recordVote never touch the network', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('network access attempted in a hermetic test');
    }) as unknown as typeof fetch;
    try {
      const store = arenaStore();
      const snapshot = await store.load();
      expect(snapshot.state.size).toBeGreaterThan(0);
      await store.recordVote(voteEvent());
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('seeds standings from the production export, split across variants', async () => {
    const { state } = await arenaStore().load();
    for (const variant of VARIANTS) {
      expect(state.has(variant.id)).toBe(true);
    }
    for (const modelId of SEED_RESERVED_MODELS) {
      const seed = seedStandings.models.find((model) => model.id === modelId)!;
      const variants = variantsOfModel(modelId);
      expect(variants.length).toBeGreaterThan(0);
      const stats = variants.map((variant) => state.get(variant.id)!);
      // Counts are split evenly (within ±1) across the model's variants and sum
      // exactly to the exported aggregates.
      const sum = (key: 'wins' | 'losses' | 'ties' | 'voteCount') =>
        stats.reduce((total, variantStats) => total + variantStats[key], 0);
      expect(sum('wins')).toBe(seed.wins);
      expect(sum('losses')).toBe(seed.losses);
      expect(sum('ties')).toBe(seed.ties);
      expect(sum('voteCount')).toBe(seed.voteCount);
      const shares = stats.map((variantStats) => variantStats.voteCount);
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    }
  });

  it('returns defensive copies from load()', async () => {
    const store = arenaStore();
    const variantId = variantsOfModel('xai-xai-tts')[0].id;
    const first = await store.load();
    const original = { ...first.state.get(variantId)! };
    first.state.get(variantId)!.wins = 999_999;
    first.state.get(variantId)!.losses = -1;
    const second = await store.load();
    expect(second.state.get(variantId)).toEqual(original);
  });

  it('folds a vote into the win/loss/tie counts (replayed from winner + ids)', async () => {
    const store = arenaStore();
    const left = variantsOfModel('inworld-tts-2')[1];
    const right = variantsOfModel('elevenlabs-flash-v2')[1];
    const before = await store.load();
    const leftBefore = before.state.get(left.id)!;
    const rightBefore = before.state.get(right.id)!;

    await store.recordVote(
      voteEvent({
        winner: 'right',
        leftVariantId: left.id,
        rightVariantId: right.id,
      }),
    );

    const after = await store.load();
    const leftAfter = after.state.get(left.id)!;
    const rightAfter = after.state.get(right.id)!;
    // winner = right: the right variant takes the win, the left the loss.
    expect(rightAfter.wins).toBe(rightBefore.wins + 1);
    expect(leftAfter.losses).toBe(leftBefore.losses + 1);
    expect(rightAfter.voteCount).toBe(rightBefore.voteCount + 1);
    expect(leftAfter.voteCount).toBe(leftBefore.voteCount + 1);
    expect(after.totalVotes).toBe(before.totalVotes + 1);
  });

  it('rejects a second vote for the same battle id with DuplicateVoteError', async () => {
    const store = arenaStore();
    const first = voteEvent();
    await store.recordVote(first);
    const before = await store.load();

    let caught: unknown;
    try {
      // Different event id, same battle id — the battle is already claimed.
      await store.recordVote(voteEvent({ battleId: first.battleId, winner: 'right' }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DuplicateVoteError);

    const after = await store.load();
    expect(after.totalVotes).toBe(before.totalVotes);
    expect(after.state.get(first.leftVariantId)).toEqual(
      before.state.get(first.leftVariantId)!,
    );
  });
});
