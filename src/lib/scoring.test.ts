/// <reference types="bun" />
import { describe, expect, it } from 'bun:test';

import {
  clamp,
  eloExpectation,
  humannessScore,
  mean,
  outcomeFor,
  parseLatencyMs,
  resultHeading,
  sortByStanding,
  voteMatchesCrowd,
} from './scoring';
import type { ScoredModel } from './types';

const scoredModel = (overrides: Partial<ScoredModel> = {}): ScoredModel => ({
  id: 'xai-xai-tts',
  provider: 'xAI',
  model: 'xAI TTS',
  elo: 1200,
  uncertainty: 40,
  wins: 10,
  losses: 5,
  ties: 1,
  likelyRank: '#1',
  voiceProfile: 0.4,
  ...overrides,
});

describe('clamp / mean', () => {
  it('clamps into the closed range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('averages values and treats the empty list as 0 (no NaN)', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBe(0);
  });
});

describe('humannessScore', () => {
  const field = [{ elo: 1306.53 }, { elo: 1257.23 }, { elo: 1200 }, { elo: 1027.55 }];

  it('reads 100 for the leader and 0 for last place', () => {
    expect(humannessScore(field[0], field)).toBe(100);
    expect(humannessScore(field[field.length - 1], field)).toBe(0);
  });

  it('is monotonic in Elo and bounded to 0–100', () => {
    const scores = field.map((model) => humannessScore(model, field));
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
    for (const score of scores) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score)).toBe(true);
    }
    // Mid-field models land strictly between the extremes.
    expect(humannessScore(field[1], field)).toBeGreaterThan(0);
    expect(humannessScore(field[1], field)).toBeLessThan(100);
  });

  it('handles a degenerate field without dividing by zero', () => {
    expect(humannessScore({ elo: 1200 }, [{ elo: 1200 }])).toBe(100);
    const tied = [{ elo: 1234 }, { elo: 1234 }, { elo: 1234 }];
    for (const model of tied) {
      expect(humannessScore(model, tied)).toBe(100);
    }
  });
});

describe('parseLatencyMs', () => {
  it('parses the 50-trial measured TTFB medians', () => {
    expect(parseLatencyMs({ provider: 'Cartesia', model: 'Sonic' })).toBe(116);
    expect(parseLatencyMs({ provider: 'Cartesia', model: 'Sonic 3.5' })).toBe(128);
    expect(parseLatencyMs({ provider: 'ElevenLabs', model: 'Turbo v2' })).toBe(302);
    expect(parseLatencyMs({ provider: 'ElevenLabs', model: 'Flash v2' })).toBe(226);
    expect(parseLatencyMs({ provider: 'ElevenLabs', model: 'Eleven v3' })).toBe(758);
    // Renamed display name (was 'MiniMax TTS'); the registry lookup keys off
    // the current name and must keep returning the measured median.
    expect(parseLatencyMs({ provider: 'MiniMax', model: 'Speech 2.5' })).toBe(325);
    expect(parseLatencyMs({ provider: 'MiniMax', model: 'MiniMax TTS' })).toBeNull();
    // Both Grok configs measured 2026-06-12 on the shared realtime WS — they
    // differ only by the optimize_streaming_latency flag (on=285, off=460).
    expect(
      parseLatencyMs({ provider: 'xAI', model: 'Grok TTS (Streaming)' }),
    ).toBe(285);
    expect(parseLatencyMs({ provider: 'xAI', model: 'Grok TTS' })).toBe(460);
  });

  it('returns null for models without a measurable public API', () => {
    // No vendor estimates: unmeasured models show a dash and plot nowhere.
    expect(parseLatencyMs({ provider: 'Canopy Labs', model: 'Orpheus' })).toBeNull();
    expect(parseLatencyMs({ provider: 'Acme Voice Co', model: 'Mystery' })).toBeNull();
  });

  it('returns the team-reported Gradium measurement', () => {
    expect(parseLatencyMs({ provider: 'Gradium', model: 'Gradium TTS' })).toBe(332);
  });
});

describe('sortByStanding', () => {
  it('sorts by Elo descending, breaking ties with lower uncertainty', () => {
    const models = [
      scoredModel({ id: 'a', elo: 1200, uncertainty: 50 }),
      scoredModel({ id: 'b', elo: 1300, uncertainty: 10 }),
      scoredModel({ id: 'c', elo: 1200, uncertainty: 5 }),
    ];
    const sorted = sortByStanding(models);
    expect(sorted.map((model) => model.id)).toEqual(['b', 'c', 'a']);
    // The input array is not mutated.
    expect(models.map((model) => model.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('eloExpectation', () => {
  it('is 0.5 for equal ratings and sums to 1 across both sides', () => {
    expect(eloExpectation(1200, 1200)).toBe(0.5);
    expect(eloExpectation(1300, 1100) + eloExpectation(1100, 1300)).toBeCloseTo(
      1,
      10,
    );
  });

  it('gives a 400-point favorite roughly a 10-to-1 expectation', () => {
    expect(eloExpectation(1400, 1000)).toBeCloseTo(10 / 11, 4);
  });
});

describe('outcomeFor', () => {
  it('scores wins, losses, and ties per side', () => {
    expect(outcomeFor('left', 'left')).toBe(1);
    expect(outcomeFor('left', 'right')).toBe(0);
    expect(outcomeFor('right', 'right')).toBe(1);
    expect(outcomeFor('tie', 'left')).toBe(0.5);
    expect(outcomeFor('tie', 'right')).toBe(0.5);
  });
});

describe('voteMatchesCrowd', () => {
  it('agrees when the pick is the higher-Elo side', () => {
    expect(voteMatchesCrowd(1300, 1200, 'left')).toBe(true);
    expect(voteMatchesCrowd(1300, 1200, 'right')).toBe(false);
    expect(voteMatchesCrowd(1200, 1300, 'right')).toBe(true);
  });

  it('treats equal Elos as a consensus tie', () => {
    expect(voteMatchesCrowd(1250, 1250, 'tie')).toBe(true);
    expect(voteMatchesCrowd(1250, 1250, 'left')).toBe(false);
    expect(voteMatchesCrowd(1250, 1250, 'right')).toBe(false);
  });

  it('only counts a tie pick as matching on a genuine coin flip', () => {
    // Gap threshold is 0.16 × 38 ≈ 6.08 Elo points.
    expect(voteMatchesCrowd(1206, 1200, 'tie')).toBe(true);
    expect(voteMatchesCrowd(1207, 1200, 'tie')).toBe(false);
  });
});

describe('resultHeading', () => {
  it('celebrates a correct pick and credits the leader otherwise', () => {
    const correct = resultHeading({ correct: true, tie: false, leaderName: 'xAI TTS' });
    const incorrect = resultHeading({
      correct: false,
      tie: false,
      leaderName: 'xAI TTS',
    });
    expect(correct).not.toBe(incorrect);
    expect(incorrect).toContain('xAI TTS');
  });

  it('handles tie picks both with and against the Index', () => {
    const agreed = resultHeading({ correct: true, tie: true, leaderName: 'Sonic 3' });
    const disagreed = resultHeading({
      correct: false,
      tie: true,
      leaderName: 'Sonic 3',
    });
    expect(agreed).not.toBe(disagreed);
    expect(disagreed).toContain('Sonic 3');
  });
});
