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

  it('only ever pairs the Human baseline on a recorded voice (clara/nelliot)', () => {
    const state = freshState();
    // Leave the Human baseline under-voted (every other variant is well-voted)
    // so coverage forcing surfaces it — on its recorded voices only.
    for (const variant of VARIANTS) {
      if (variant.modelId === 'human') continue;
      state.set(variant.id, { ...freshVariantStats(), voteCount: 50 });
    }
    let humanBattles = 0;
    for (let i = 0; i < 200; i += 1) {
      const [left, right] = chooseBattlePair(state);
      // (A) Same source voice on both sides, always.
      expect(left.sourceVoiceId).toBe(right.sourceVoiceId);
      expect(left.modelId).not.toBe(right.modelId);
      const human = [left, right].find((v) => v.modelId === 'human');
      if (!human) continue;
      humanBattles += 1;
      // The Human serves only Clara/Nelliot, so it can never land on emma/godfrey;
      // the opponent reads that same recorded voice.
      expect(['voice-clara', 'voice-nelliot']).toContain(human.sourceVoiceId);
    }
    // The under-voted Human is still surfaced (on its recorded voices) — it just
    // no longer monopolizes the schedule (see the uniformity test below).
    expect(humanBattles).toBeGreaterThan(0);
  });

  it('keeps the source-voice mix ~uniform even when the Human baseline lags (B)', () => {
    const state = freshState();
    // A warm, even field with the Human baseline far behind: the exact shape
    // that used to collapse the schedule onto the Human's two voices
    // (Clara/Nelliot at ~50/50, Emma/Godfrey at 0).
    for (const variant of VARIANTS) {
      const voteCount = variant.modelId === 'human' ? 0 : 100;
      state.set(variant.id, { ...freshVariantStats(), voteCount });
    }
    const draws = 4000;
    const byVoice = new Map<string, number>();
    for (let i = 0; i < draws; i += 1) {
      const [left, right] = chooseBattlePair(state);
      expect(left.sourceVoiceId).toBe(right.sourceVoiceId);
      byVoice.set(left.sourceVoiceId, (byVoice.get(left.sourceVoiceId) ?? 0) + 1);
    }
    // Every roster voice comes up, none far from the 25% uniform share.
    for (const voiceId of [
      'voice-clara',
      'voice-emma',
      'voice-godfrey',
      'voice-nelliot',
    ]) {
      const share = (byVoice.get(voiceId) ?? 0) / draws;
      expect(share).toBeGreaterThan(0.18);
      expect(share).toBeLessThan(0.32);
    }
  });

  it('prefers pairs touching an under-voted model (within each voice it serves)', () => {
    const state = freshState();
    // Give every variant a vote except those of one lagging model. The lagging
    // model serves all four voices, so coverage forcing surfaces it whichever
    // voice is drawn.
    const laggingModelId = VARIANTS[0].modelId;
    for (const variant of VARIANTS) {
      if (variant.modelId === laggingModelId) continue;
      state.set(variant.id, { ...freshVariantStats(), voteCount: 10 });
    }
    let touchedLagging = 0;
    for (let i = 0; i < 80; i += 1) {
      const [left, right] = chooseBattlePair(state);
      if (left.modelId === laggingModelId || right.modelId === laggingModelId) {
        touchedLagging += 1;
      }
    }
    // Per-voice coverage forcing means every pick still includes the lagging model.
    expect(touchedLagging).toBe(80);
  });
});
