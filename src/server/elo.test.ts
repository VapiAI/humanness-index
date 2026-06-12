/// <reference types="bun" />
import { describe, expect, it } from 'bun:test';

import { VARIANTS } from './catalog';
import {
  applyVoteToStats,
  calculateElo,
  chooseBattlePair,
  freshVariantStats,
  INITIAL_ELO,
  leaderboard,
  type StandingsState,
} from './elo';

const freshState = (): StandingsState =>
  new Map(VARIANTS.map((variant) => [variant.id, freshVariantStats()]));

describe('calculateElo', () => {
  it('is zero-sum and symmetric for equal ratings', () => {
    const [left, right] = calculateElo(1200, 1200, 1, 0);
    // K=32, expected 0.5 each → winner +16, loser -16.
    expect(left).toBe(1216);
    expect(right).toBe(1184);
  });

  it('awards less to a heavy favorite and more to an upset winner', () => {
    const [favoriteWin] = calculateElo(1400, 1000, 1, 0);
    const favoriteGain = favoriteWin - 1400;
    const [underdogWin] = calculateElo(1000, 1400, 1, 0);
    const underdogGain = underdogWin - 1000;
    expect(underdogGain).toBeGreaterThan(favoriteGain);
  });

  it('moves ratings toward each other on a tie', () => {
    const [left, right] = calculateElo(1300, 1100, 0.5, 0.5);
    expect(left).toBeLessThan(1300);
    expect(right).toBeGreaterThan(1100);
  });
});

describe('applyVoteToStats', () => {
  it('records a win/loss and conserves total Elo', () => {
    const left = freshVariantStats();
    const right = freshVariantStats();
    const result = applyVoteToStats(left, right, 'left');
    expect(result.left.wins).toBe(1);
    expect(result.left.losses).toBe(0);
    expect(result.right.losses).toBe(1);
    expect(result.left.voteCount).toBe(1);
    expect(result.right.voteCount).toBe(1);
    expect(result.left.elo + result.right.elo).toBeCloseTo(INITIAL_ELO * 2, 5);
  });

  it('records a tie on both sides', () => {
    const result = applyVoteToStats(freshVariantStats(), freshVariantStats(), 'tie');
    expect(result.left.ties).toBe(1);
    expect(result.right.ties).toBe(1);
    expect(result.left.elo).toBe(result.right.elo);
  });
});

describe('leaderboard', () => {
  it('lists every model, sorted by Elo descending', () => {
    const rows = leaderboard(freshState());
    const modelIds = new Set(VARIANTS.map((variant) => variant.modelId));
    expect(rows.length).toBe(modelIds.size);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].elo).toBeGreaterThanOrEqual(rows[i].elo);
    }
  });

  it('reflects an applied vote in the winning model row', () => {
    const state = freshState();
    const [a, b] = VARIANTS.filter((v, _i, all) => v.modelId !== all[0].modelId)
      .slice(0, 1)
      .concat(VARIANTS[0]);
    const updated = applyVoteToStats(state.get(a.id)!, state.get(b.id)!, 'left');
    state.set(a.id, updated.left);
    state.set(b.id, updated.right);
    const winnerRow = leaderboard(state).find((row) => row.id === a.modelId);
    expect(winnerRow?.wins).toBe(1);
    expect(winnerRow!.elo).toBeGreaterThan(INITIAL_ELO);
  });

  it('widens uncertainty when a row has fewer votes', () => {
    const rows = leaderboard(freshState());
    // No votes → standard error 160/sqrt(1) = 160 for every row.
    expect(rows[0].uncertainty).toBe(160);
  });
});

describe('chooseBattlePair', () => {
  it('always pairs two distinct models of the same source voice', () => {
    const state = freshState();
    for (let i = 0; i < 200; i += 1) {
      const [left, right] = chooseBattlePair(state);
      expect(left.id).not.toBe(right.id);
      expect(left.sourceVoiceId).toBe(right.sourceVoiceId);
      expect(left.modelId).not.toBe(right.modelId);
    }
  });

  it('prefers pairs touching an under-voted model', () => {
    const state = freshState();
    // Give every variant a vote except those of one lagging model.
    const laggingModelId = VARIANTS[0].modelId;
    for (const variant of VARIANTS) {
      if (variant.modelId === laggingModelId) continue;
      state.set(variant.id, { ...freshVariantStats(), voteCount: 10 });
    }
    let touchedLagging = 0;
    for (let i = 0; i < 50; i += 1) {
      const [left, right] = chooseBattlePair(state);
      if (left.modelId === laggingModelId || right.modelId === laggingModelId) {
        touchedLagging += 1;
      }
    }
    // Coverage forcing means every pick must include the lagging model.
    expect(touchedLagging).toBe(50);
  });
});
