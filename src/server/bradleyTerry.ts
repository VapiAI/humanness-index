/**
 * Bradley–Terry ratings from pairwise outcomes, fit by the MM algorithm
 * (Hunter 2004), plus bootstrap rank ranges.
 *
 * This is the published rating: unlike online Elo (a fixed-step random walk
 * that never settles), a Bradley–Terry maximum-likelihood fit is an
 * all-history estimate that converges as votes accumulate (error ~1/√n) and
 * accounts for opponent strength. It is computed deterministically from the
 * full, immutable vote log — switching to it re-folds the same events, never
 * mutating or dropping any.
 *
 * Seed/anchor handling (no data loss): the original prototype export only
 * carries per-model win/loss/tie totals, not pairwise matchups, so those votes
 * are injected as games against a fixed center-strength reference. They still
 * count and still move the rating, the live pairwise votes just dominate.
 */

/** Display center of the (Elo-like) scale, where a field-average voice sits. */
export const BT_CENTER = 1200;
/** Convert a Bradley–Terry log-strength to Elo-style points (the 400/decade scale). */
const ELO_PER_LOGIT = 400 / Math.LN10;

export type Outcome = { left: string; right: string; winner: 'left' | 'right' | 'tie' };

/** Aggregate record vs a center-strength reference (used for the seed export). */
export type AnchorRecord = { wins: number; losses: number; ties: number };

export type FitInput = {
  /** All model ids to rate. */
  players: string[];
  /** Live pairwise outcomes (model id vs model id). */
  outcomes: Outcome[];
  /** Per-model aggregate record vs the center reference (the seed export). */
  anchors?: Map<string, AnchorRecord>;
  /**
   * Virtual games vs the center added to every player for identifiability and
   * stability (keeps undefeated/winless models finite, anchors the scale).
   */
  prior?: number;
  iterations?: number;
  /** Warm-start strengths (π) — speeds up bootstrap refits. */
  start?: Map<string, number>;
};

/** wins[i].get(j) = fractional wins of i over j (a tie adds 0.5 to each side). */
const buildWinMatrix = (
  players: string[],
  outcomes: Outcome[],
): Map<string, Map<string, number>> => {
  const wins = new Map<string, Map<string, number>>(
    players.map((p) => [p, new Map<string, number>()]),
  );
  const add = (i: string, j: string, v: number) => {
    const row = wins.get(i);
    if (!row) return;
    row.set(j, (row.get(j) ?? 0) + v);
  };
  for (const o of outcomes) {
    if (!wins.has(o.left) || !wins.has(o.right) || o.left === o.right) continue;
    if (o.winner === 'left') add(o.left, o.right, 1);
    else if (o.winner === 'right') add(o.right, o.left, 1);
    else {
      add(o.left, o.right, 0.5);
      add(o.right, o.left, 0.5);
    }
  }
  return wins;
};

/** MM fit → player id → strength π (center reference fixed at π = 1). */
const fitStrengths = ({
  players,
  outcomes,
  anchors,
  prior = 1,
  iterations = 500,
  start,
}: FitInput): Map<string, number> => {
  const wins = buildWinMatrix(players, outcomes);
  // Precompute each player's opponents with their combined game counts so the
  // per-iteration loop only touches pairs that actually played.
  const opponents = new Map<string, { j: string; nij: number }[]>();
  const totalWins = new Map<string, number>();
  for (const i of players) {
    const wi = wins.get(i)!;
    const list: { j: string; nij: number }[] = [];
    let w = 0;
    for (const j of players) {
      if (j === i) continue;
      const wij = wi.get(j) ?? 0;
      const wji = wins.get(j)!.get(i) ?? 0;
      const nij = wij + wji;
      if (nij > 0) list.push({ j, nij });
      w += wij;
    }
    opponents.set(i, list);
    totalWins.set(i, w);
  }

  const pi = new Map(players.map((p) => [p, start?.get(p) ?? 1]));
  for (let iter = 0; iter < iterations; iter += 1) {
    let maxChange = 0;
    const next = new Map<string, number>();
    for (const i of players) {
      const piI = pi.get(i)!;
      let num = totalWins.get(i)!;
      let den = 0;
      for (const { j, nij } of opponents.get(i)!) {
        den += nij / (piI + pi.get(j)!);
      }
      // Seed export: aggregate games vs the center reference (π = 1).
      const a = anchors?.get(i);
      if (a) {
        const games = a.wins + a.losses + a.ties;
        if (games > 0) {
          num += a.wins + 0.5 * a.ties;
          den += games / (piI + 1);
        }
      }
      // Symmetric prior: `prior` virtual games split evenly vs the center.
      if (prior > 0) {
        num += prior / 2;
        den += prior / (piI + 1);
      }
      const newPi = den > 0 ? num / den : piI;
      next.set(i, newPi);
      maxChange = Math.max(maxChange, Math.abs(Math.log(newPi) - Math.log(piI)));
    }
    for (const [k, v] of next) pi.set(k, v);
    if (maxChange < 1e-10) break;
  }
  return pi;
};

/** Fit Bradley–Terry and return Elo-scale ratings (center = BT_CENTER). */
export const bradleyTerryRatings = (input: FitInput): Map<string, number> => {
  const pi = fitStrengths(input);
  const ratings = new Map<string, number>();
  for (const [player, strength] of pi) {
    ratings.set(player, BT_CENTER + ELO_PER_LOGIT * Math.log(strength));
  }
  return ratings;
};

/** Also return the raw strengths, so a bootstrap can warm-start from them. */
export const bradleyTerryFit = (
  input: FitInput,
): { ratings: Map<string, number>; strengths: Map<string, number> } => {
  const strengths = fitStrengths(input);
  const ratings = new Map<string, number>();
  for (const [player, s] of strengths) {
    ratings.set(player, BT_CENTER + ELO_PER_LOGIT * Math.log(s));
  }
  return { ratings, strengths };
};

/** Small deterministic PRNG so bootstrap ranges are stable across recomputes. */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const resample = <T>(items: readonly T[], rng: () => number): T[] => {
  const n = items.length;
  const out: T[] = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = items[Math.floor(rng() * n)];
  return out;
};

/**
 * Bootstrap rank ranges over `ranked` players (e.g. the competitors, excluding
 * the Human baseline). Resamples the live outcomes with replacement, refits,
 * and returns each player's [low, high] rank across the central `interval`
 * fraction of resamples — an honest "likely rank" that reflects how much the
 * data actually pins each position down.
 */
export const bootstrapRankRange = (
  input: FitInput,
  ranked: string[],
  options: { resamples?: number; interval?: number } = {},
): Map<string, { low: number; high: number }> => {
  const { resamples = 200, interval = 0.95 } = options;
  // Warm-start every refit from the full-data fit so each converges fast.
  const warm = fitStrengths(input);
  // Seed off the dataset size so the ranges are deterministic for a given log
  // (no run-to-run jitter), but still evolve as votes accumulate.
  const rng = mulberry32(input.outcomes.length * 2654435761);
  const ranksByPlayer = new Map<string, number[]>(ranked.map((p) => [p, []]));
  for (let b = 0; b < resamples; b += 1) {
    const strengths = fitStrengths({
      ...input,
      outcomes: resample(input.outcomes, rng),
      start: warm,
      iterations: 60,
    });
    const order = [...ranked].sort(
      (a, z) => (strengths.get(z) ?? 0) - (strengths.get(a) ?? 0),
    );
    order.forEach((player, index) => ranksByPlayer.get(player)!.push(index + 1));
  }
  const tail = (1 - interval) / 2;
  const ranges = new Map<string, { low: number; high: number }>();
  for (const [player, ranks] of ranksByPlayer) {
    ranks.sort((a, z) => a - z);
    const lo = ranks[Math.floor(tail * (ranks.length - 1))];
    const hi = ranks[Math.ceil((1 - tail) * (ranks.length - 1))];
    ranges.set(player, { low: lo, high: hi });
  }
  return ranges;
};

/**
 * "#3" or "#3-7" from a bootstrap range. Uses a hyphen (the stored convention);
 * the table swaps it for an en dash at display time.
 */
export const formatRankRange = (range: { low: number; high: number }): string =>
  range.low === range.high ? `#${range.low}` : `#${range.low}-${range.high}`;
