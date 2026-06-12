import { modelEntryByDisplayName } from '../catalog';
import type { ArenaRow, ScoredModel, VoteChoice } from './types';

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const mean = (values: number[]) =>
  values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;

/**
 * The published Humanness transform: 0–100, min-max normalized over the
 * current field's Elo — the leader reads 100, the last place reads 0.
 */
export const humannessScore = (
  model: Pick<ScoredModel, 'elo'>,
  allModels: readonly Pick<ScoredModel, 'elo'>[],
) => {
  const elos = allModels.map((m) => m.elo);
  const minElo = Math.min(...elos);
  const maxElo = Math.max(...elos);
  // A single-model or fully tied field has no spread to normalize against.
  if (maxElo === minElo) return 100;
  return clamp(
    Math.round(((model.elo - minElo) / (maxElo - minElo)) * 100),
    0,
    100,
  );
};

/** Measured TTFB in ms, or null for models without a measurable public API. */
export const parseLatencyMs = (
  model: Pick<ArenaRow, 'provider' | 'model'>,
): number | null =>
  modelEntryByDisplayName(model.provider, model.model)?.stats.latencyMs
    ?.value ?? null;

export const sortByStanding = (models: ScoredModel[]) =>
  [...models].sort((a, b) => b.elo - a.elo || a.uncertainty - b.uncertainty);

/** Standard Elo expectation for the left side of a pairing. */
export const eloExpectation = (leftElo: number, rightElo: number) =>
  1 / (1 + 10 ** ((rightElo - leftElo) / 400));

export const outcomeFor = (winner: VoteChoice, side: 'left' | 'right') => {
  if (winner === 'tie') return 0.5;
  return winner === side ? 1 : 0;
};

/**
 * The Humanness spread is compressed (~1215–1265), so closeness is judged
 * against the real gap between the two voices, not the raw 400-point Elo
 * scale. Gaps at/above this many points count as an "obvious" matchup.
 */
const CROWD_GAP_SCALE = 38;

/**
 * Whether a pick agrees with the crowd (the higher-Elo voice). A tie only
 * "matches the crowd" on a genuine coin flip.
 */
export const voteMatchesCrowd = (
  leftElo: number,
  rightElo: number,
  winner: VoteChoice,
): boolean => {
  if (winner === 'tie') {
    return Math.abs(leftElo - rightElo) / CROWD_GAP_SCALE < 0.16;
  }
  const consensus: VoteChoice =
    leftElo === rightElo ? 'tie' : leftElo > rightElo ? 'left' : 'right';
  return winner === consensus;
};

/** Reveal-view headline after a pick. */
export const resultHeading = ({
  correct,
  tie,
  leaderName,
}: {
  correct: boolean;
  tie: boolean;
  leaderName: string;
}) => {
  if (tie) {
    return correct
      ? 'Too close to call. The Index agrees.'
      : `A fair tie, though most listeners give ${leaderName} a slight edge.`;
  }
  return correct
    ? 'Great ears. Your pick ranks higher on the Index.'
    : `Love it, though most listeners lean toward ${leaderName}.`;
};
