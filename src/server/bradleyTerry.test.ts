/// <reference types="bun" />
import { describe, expect, it } from 'bun:test';

import {
  bootstrapRankRange,
  bradleyTerryFit,
  formatRankRange,
  type Outcome,
} from './bradleyTerry';

const beats = (winner: string, loser: string, n: number): Outcome[] =>
  Array.from({ length: n }, () => ({ left: winner, right: loser, winner: 'left' as const }));

describe('bradleyTerryFit', () => {
  it('orders a transitive chain by strength', () => {
    const players = ['a', 'b', 'c'];
    const outcomes = [...beats('a', 'b', 20), ...beats('b', 'c', 20)];
    const { ratings } = bradleyTerryFit({ players, outcomes, prior: 1 });
    expect(ratings.get('a')!).toBeGreaterThan(ratings.get('b')!);
    expect(ratings.get('b')!).toBeGreaterThan(ratings.get('c')!);
  });

  it('rewards beating a stronger opponent (opponent-strength adjustment)', () => {
    // strong is clearly the best; `hard` beats strong half the time, `easy`
    // only ever beats the weakest. `hard` should out-rate `easy`.
    const players = ['strong', 'hard', 'easy', 'weak'];
    const outcomes = [
      ...beats('strong', 'weak', 30),
      ...beats('strong', 'easy', 20),
      ...beats('hard', 'strong', 10),
      ...beats('strong', 'hard', 10), // hard splits with strong
      ...beats('easy', 'weak', 30), // easy only farms the weakest
    ];
    const { ratings } = bradleyTerryFit({ players, outcomes, prior: 1 });
    expect(ratings.get('hard')!).toBeGreaterThan(ratings.get('easy')!);
  });

  it('is deterministic and converges (same input → same ratings)', () => {
    const players = ['a', 'b', 'c'];
    const outcomes = [...beats('a', 'b', 12), ...beats('c', 'a', 5)];
    const first = bradleyTerryFit({ players, outcomes, prior: 1 }).ratings;
    const second = bradleyTerryFit({ players, outcomes, prior: 1 }).ratings;
    for (const p of players) {
      expect(second.get(p)!).toBeCloseTo(first.get(p)!, 6);
    }
  });

  it('folds anchor (seed) records into the rating', () => {
    const players = ['x', 'y'];
    // No live games; x has a strong seed record vs the center, y a poor one.
    const anchors = new Map([
      ['x', { wins: 40, losses: 5, ties: 0 }],
      ['y', { wins: 5, losses: 40, ties: 0 }],
    ]);
    const { ratings } = bradleyTerryFit({ players, outcomes: [], anchors, prior: 1 });
    expect(ratings.get('x')!).toBeGreaterThan(ratings.get('y')!);
  });
});

describe('bootstrapRankRange', () => {
  it('gives a clear leader a tight top rank and is deterministic', () => {
    const players = ['a', 'b', 'c'];
    const outcomes = [...beats('a', 'b', 60), ...beats('a', 'c', 60), ...beats('b', 'c', 40)];
    const input = { players, outcomes, prior: 1 };
    const ranges = bootstrapRankRange(input, players, { resamples: 100 });
    expect(ranges.get('a')!.low).toBe(1);
    expect(ranges.get('a')!.high).toBe(1); // dominant → always #1
    // Deterministic across runs (seeded off the dataset).
    const again = bootstrapRankRange(input, players, { resamples: 100 });
    for (const p of players) {
      expect(again.get(p)).toEqual(ranges.get(p)!);
    }
  });

  it('widens the range for near-tied models', () => {
    const players = ['a', 'b'];
    // A genuine coin flip → either could be #1.
    const outcomes = [...beats('a', 'b', 25), ...beats('b', 'a', 25)];
    const ranges = bootstrapRankRange({ players, outcomes, prior: 1 }, players, {
      resamples: 100,
    });
    expect(ranges.get('a')!.high).toBe(2);
  });
});

describe('formatRankRange', () => {
  it('prints an exact rank or a hyphenated range', () => {
    expect(formatRankRange({ low: 3, high: 3 })).toBe('#3');
    expect(formatRankRange({ low: 3, high: 7 })).toBe('#3-7');
  });
});
