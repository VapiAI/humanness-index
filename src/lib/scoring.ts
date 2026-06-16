import { modelEntryByDisplayName } from '../catalog';
import type { ArenaRow, BattleSide, ScoredModel, VoteChoice } from './types';

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const mean = (values: number[]) =>
  values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;

/**
 * The published Humanness transform: 0 at the field floor, 100 at the Human
 * baseline, and ABOVE 100 for any voice listeners judge more human than the
 * real person.
 *
 * When a Human baseline is in the field it anchors the scale: the baseline
 * always reads 100, and every competitor is normalized against
 * [minElo, baselineElo], so a score reads as a share of the human mark. With
 * Human seeded above the field (see server/seed-standings.json) the top TTS
 * lands a clean gap below 100 from day one; but the top is left OPEN, so a
 * competitor that out-rates the baseline reads above 100 (super-human) rather
 * than being capped. The Human itself stays pinned to 100 as the reference.
 * With no baseline present it falls back to a plain min-max over the field
 * (the strongest competitor anchors the top at 100).
 */
export const humannessScore = (
  model: Pick<ScoredModel, 'elo' | 'baseline'>,
  allModels: readonly Pick<ScoredModel, 'elo' | 'baseline'>[],
) => {
  // The baseline is the anchor; it always reads 100.
  if (model.baseline) return 100;
  const elos = allModels.map((m) => m.elo);
  const minElo = Math.min(...elos);
  const baseline = allModels.find((m) => m.baseline);
  // The Human baseline anchors 100, so a competitor that overtakes it reads
  // above 100. Without a baseline, the strongest competitor anchors the top.
  const anchorElo = baseline
    ? baseline.elo
    : Math.max(...allModels.filter((m) => !m.baseline).map((m) => m.elo));
  // A single-model or fully tied field has no spread to normalize against.
  if (anchorElo === minElo) return 100;
  // Floor at 0 (the field's worst); the top is intentionally uncapped so a
  // super-human voice can exceed 100.
  return Math.max(
    0,
    Math.round(((model.elo - minElo) / (anchorElo - minElo)) * 100),
  );
};

/** Measured TTFB in ms, or null for models without a measurable public API. */
export const parseLatencyMs = (
  model: Pick<ArenaRow, 'provider' | 'model'>,
): number | null =>
  modelEntryByDisplayName(model.provider, model.model)?.stats.latencyMs
    ?.value ?? null;

/**
 * Standing order, best first. The Human baseline is always pinned to the top
 * (it is the reference the field is measured against, not a ranked
 * competitor); the rest sort by Elo, breaking ties with lower uncertainty.
 */
export const sortByStanding = (models: ScoredModel[]) =>
  [...models].sort(
    (a, b) =>
      Number(Boolean(b.baseline)) - Number(Boolean(a.baseline)) ||
      b.elo - a.elo ||
      a.uncertainty - b.uncertainty,
  );

/**
 * 1-based rank among ranked competitors, ignoring any baseline rows (so the
 * top model is #1 whether or not the Human baseline sits above it). Returns 0
 * for a baseline row, which has no competitive rank.
 */
export const competitorRank = (
  id: string,
  models: readonly Pick<ScoredModel, 'id' | 'baseline'>[],
): number =>
  models.filter((m) => !m.baseline).findIndex((m) => m.id === id) + 1;

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

/**
 * Reveal-view headline after a pick. Battles are mixed, so the copy is honest
 * either way: when a real Human recording is one of the two voices it calls out
 * whether the listener spotted the person or got fooled; when both voices are
 * synthetic it speaks to the crowd consensus instead.
 */
export const revealHeadline = ({
  winner,
  correct,
  humanSide,
  pickedName,
  crowdName,
}: {
  winner: VoteChoice;
  correct: boolean;
  /** The side the real Human baseline is on, or null if both are synthetic. */
  humanSide: BattleSide | null;
  /** Display name of the voice the listener picked (null on a tie). */
  pickedName: string | null;
  /** Display name of the crowd-favored (higher-Elo) voice. */
  crowdName: string;
}): string => {
  if (humanSide) {
    if (winner === 'tie') {
      return 'Too close to call, and one of them was a real person.';
    }
    return winner === humanSide
      ? 'That one was a real person. Great ear.'
      : `Fooled you. That was ${pickedName}. The real person was the other voice.`;
  }
  if (winner === 'tie') return 'A dead heat. The Index agrees.';
  return correct
    ? 'Good ear. The crowd hears your pick as more human too.'
    : `Most listeners hear ${crowdName} as more human.`;
};
