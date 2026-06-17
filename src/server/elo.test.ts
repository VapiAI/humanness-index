/// <reference types="bun" />
import { describe, expect, it } from 'bun:test';

import { VARIANTS } from './catalog';
import {
  applyVoteToCounts,
  chooseBattlePair,
  freshVariantStats,
  type StandingsState,
} from './elo';

const freshState = (): StandingsState =>
  new Map(VARIANTS.map((variant) => [variant.id, freshVariantStats()]));

describe('applyVoteToCounts', () => {
  it('tallies a win/loss into both sides', () => {
    const result = applyVoteToCounts(freshVariantStats(), freshVariantStats(), 'left');
    expect(result.left.wins).toBe(1);
    expect(result.left.losses).toBe(0);
    expect(result.right.losses).toBe(1);
    expect(result.left.voteCount).toBe(1);
    expect(result.right.voteCount).toBe(1);
  });

  it('tallies a tie on both sides', () => {
    const result = applyVoteToCounts(freshVariantStats(), freshVariantStats(), 'tie');
    expect(result.left.ties).toBe(1);
    expect(result.right.ties).toBe(1);
    expect(result.left.wins).toBe(0);
    expect(result.right.wins).toBe(0);
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

  it('only ever pairs the Human baseline on a recorded voice (clara/nelliot/godfrey/emma)', () => {
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
      // The Human now serves all four recorded source voices; the opponent
      // reads that same recorded voice.
      expect([
        'voice-clara',
        'voice-nelliot',
        'voice-godfrey',
        'voice-emma',
      ]).toContain(human.sourceVoiceId);
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
