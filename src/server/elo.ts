/**
 * Arena vote folding + convergence-weighted battle pairing.
 *
 * The PUBLISHED rating is Bradley–Terry (see bradleyTerry.ts) — fit over the
 * full vote log and cached. This module owns the per-variant win/loss/tie fold
 * the fit and the "Votes" column read from, plus the pairing that schedules the
 * next blind matchup (coverage, uncertainty reduction, and BT-rating closeness).
 * The Elo math here is the audit trail folded alongside the counts; it no longer
 * feeds the leaderboard, pairing, or crowd-judgment.
 */
import { VARIANTS, type CatalogVariant } from './catalog';

export type VoteWinner = 'left' | 'right' | 'tie';

export type VariantStats = {
  elo: number;
  wins: number;
  losses: number;
  ties: number;
  voteCount: number;
};

/** variant id → stats; the entire mutable state of the arena. */
export type StandingsState = Map<string, VariantStats>;

export const INITIAL_ELO = 1200;
const K_FACTOR = 32;

export const freshVariantStats = (): VariantStats => ({
  elo: INITIAL_ELO,
  wins: 0,
  losses: 0,
  ties: 0,
  voteCount: 0,
});

const expectedScore = (leftElo: number, rightElo: number) =>
  1 / (1 + 10 ** ((rightElo - leftElo) / 400));

const round2 = (value: number) => Math.round(value * 100) / 100;

export const calculateElo = (
  leftElo: number,
  rightElo: number,
  leftScore: number,
  rightScore: number,
): [number, number] => {
  const expectedLeft = expectedScore(leftElo, rightElo);
  const expectedRight = 1 - expectedLeft;
  return [
    round2(leftElo + K_FACTOR * (leftScore - expectedLeft)),
    round2(rightElo + K_FACTOR * (rightScore - expectedRight)),
  ];
};

const scoresForWinner = (winner: VoteWinner): [number, number] => {
  if (winner === 'left') return [1, 0];
  if (winner === 'right') return [0, 1];
  return [0.5, 0.5];
};

/** Apply one head-to-head outcome, returning fresh stats for both variants. */
export const applyVoteToStats = (
  left: VariantStats,
  right: VariantStats,
  winner: VoteWinner,
): { left: VariantStats; right: VariantStats } => {
  const [leftScore, rightScore] = scoresForWinner(winner);
  const [leftElo, rightElo] = calculateElo(left.elo, right.elo, leftScore, rightScore);
  return {
    left: {
      elo: leftElo,
      wins: left.wins + (winner === 'left' ? 1 : 0),
      losses: left.losses + (winner === 'right' ? 1 : 0),
      ties: left.ties + (winner === 'tie' ? 1 : 0),
      voteCount: left.voteCount + 1,
    },
    right: {
      elo: rightElo,
      wins: right.wins + (winner === 'right' ? 1 : 0),
      losses: right.losses + (winner === 'left' ? 1 : 0),
      ties: right.ties + (winner === 'tie' ? 1 : 0),
      voteCount: right.voteCount + 1,
    },
  };
};

/** Standard error of an Elo estimate after `voteCount` votes (160/√n). */
const eloStandardError = (voteCount: number) => 160 / Math.sqrt(Math.max(1, voteCount));

/* --------------------------------------------------------------------------
 * Convergence-weighted battle pairing (port of
 * _choose_convergence_weighted_model_pair and helpers).
 * ------------------------------------------------------------------------ */

type Pair = [CatalogVariant, CatalogVariant];

const statsFor = (state: StandingsState, variantId: string): VariantStats =>
  state.get(variantId) ?? freshVariantStats();

const modelVoteCounts = (state: StandingsState): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const variant of VARIANTS) {
    counts.set(
      variant.modelId,
      (counts.get(variant.modelId) ?? 0) + statsFor(state, variant.id).voteCount,
    );
  }
  return counts;
};

const variantVoteCounts = (state: StandingsState): Map<string, number> =>
  new Map(VARIANTS.map((variant) => [variant.id, statsFor(state, variant.id).voteCount]));

const uncertaintyGain = (voteCount: number) =>
  eloStandardError(voteCount) - eloStandardError(voteCount + 1);

/**
 * All same-voice, different-model pairs, grouped by their shared source voice.
 *
 * Pairs are formed within a shared source voice over VARIANTS, and a model
 * only has variants for the voices it actually serves (ModelEntry.sourceVoices
 * via server/catalog.ts). So a pair's voice is always in BOTH models'
 * available voices — the shared-voice intersection is enforced by construction,
 * and a model (e.g. the Human baseline mid-rollout, which serves only
 * Clara/Nelliot) is never paired on a voice it lacks.
 *
 * Returned keyed by voiceId so the picker can choose a voice first (see
 * chooseBattlePair): selecting the voice up front makes "both sides share the
 * source voice" structural rather than incidental, and keeps the source-voice
 * mix even across the roster.
 */
const pairsByVoice = (): Map<string, Pair[]> => {
  const variantsByVoice = new Map<string, CatalogVariant[]>();
  for (const variant of VARIANTS) {
    const group = variantsByVoice.get(variant.sourceVoiceId) ?? [];
    group.push(variant);
    variantsByVoice.set(variant.sourceVoiceId, group);
  }
  const byVoice = new Map<string, Pair[]>();
  for (const [voiceId, group] of variantsByVoice) {
    const pairs: Pair[] = [];
    for (let i = 0; i < group.length - 1; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        pairs.push([group[i], group[j]]);
      }
    }
    // A voice served by a single model has no valid (different-model) pair;
    // drop it so it can never be chosen.
    if (pairs.length > 0) byVoice.set(voiceId, pairs);
  }
  return byVoice;
};

/**
 * Pick the next blind pairing.
 *
 * (A) Same source voice on BOTH sides, always: the voice is chosen first, then
 * a model pair *within* that voice — so a battle structurally cannot cross
 * voices (including Human-baseline battles, which only ever land on a recorded
 * voice the Human serves).
 *
 * (B) Source voice ~uniform across the available roster: the voice is chosen
 * uniformly at random, so no voice dominates. This is what stops the schedule
 * from collapsing onto the Human baseline's voices (Clara/Nelliot) — the
 * earlier global, summed-vote coverage weighting over-served them because the
 * Human, serving only two voices, looks perpetually under-covered.
 *
 * Within the chosen voice the pairing still favors information gain: under-voted
 * models first, then weight by uncertainty reduction and close matchups. Close
 * matchups are judged on the supplied model-level Bradley–Terry `ratings` (the
 * published numbers); without them (cold cache) the close-match term is uniform
 * and pairing falls back to coverage + uncertainty.
 */
export const chooseBattlePair = (
  state: StandingsState,
  ratings?: ReadonlyMap<string, number>,
): Pair => {
  const byVoice = pairsByVoice();
  // (B) Uniform source-voice choice across the voices that have a valid pair.
  const voiceIds = [...byVoice.keys()];
  const voiceId = voiceIds[Math.floor(Math.random() * voiceIds.length)];
  let pairs = byVoice.get(voiceId)!;

  const modelVotes = modelVoteCounts(state);

  // Force coverage WITHIN the chosen voice: if a model that serves this voice
  // lags the field, only consider this voice's pairs that touch a lagging
  // model. Scoping it to the voice keeps coverage forcing from ever collapsing
  // the source-voice mix onto one under-voted model's voices (the (B) bug).
  const counts = [...modelVotes.values()];
  const targetVoteCount = Math.max(...counts);
  const lowestVoteCount = Math.min(...counts);
  if (lowestVoteCount < targetVoteCount) {
    const undercovered = new Set(
      [...modelVotes.entries()]
        .filter(([, votes]) => votes === lowestVoteCount)
        .map(([modelId]) => modelId),
    );
    const covering = pairs.filter(
      ([left, right]) => undercovered.has(left.modelId) || undercovered.has(right.modelId),
    );
    // Only narrow when a lagging model actually serves this voice; otherwise
    // weight the voice's full pair set below.
    if (covering.length > 0) pairs = covering;
  }

  const variantVotes = variantVoteCounts(state);
  const ratingOf = (modelId: string) => ratings?.get(modelId) ?? INITIAL_ELO;

  const weights = pairs.map(([left, right]) => {
    const leftVotes = modelVotes.get(left.modelId) ?? 0;
    const rightVotes = modelVotes.get(right.modelId) ?? 0;
    const coverageGap = Math.max(0, targetVoteCount - Math.min(leftVotes, rightVotes));
    const coverage = coverageGap + 1;
    const uncertainty = uncertaintyGain(leftVotes) + uncertaintyGain(rightVotes);
    const expectedLeft = expectedScore(ratingOf(left.modelId), ratingOf(right.modelId));
    const closeMatch = 4 * expectedLeft * (1 - expectedLeft);
    // Within the chosen voice, favor the less-sampled of its variants.
    const variantBalance =
      uncertaintyGain(variantVotes.get(left.id) ?? 0) +
      uncertaintyGain(variantVotes.get(right.id) ?? 0);
    return 1 + coverage + 8 * uncertainty + 6 * closeMatch + variantBalance;
  });

  const pair = weightedChoice(pairs, weights);
  // Shuffle sides so position never encodes identity.
  return Math.random() < 0.5 ? pair : [pair[1], pair[0]];
};

const weightedChoice = <T>(items: T[], weights: number[]): T => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = Math.random() * total;
  for (let index = 0; index < items.length; index += 1) {
    threshold -= weights[index];
    if (threshold <= 0) return items[index];
  }
  return items[items.length - 1];
};
