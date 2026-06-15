import type { CSSProperties } from 'react';

import { humannessScore } from '../lib/scoring';
import type { ScoredModel } from '../lib/types';

/**
 * Where this model sits low to high, as a slim filled meter. The marker tracks
 * the model's Humanness score (0 to 100), so it always agrees with the number
 * shown beside it.
 *
 * The fill (scaleX) and thumb (a full-width rail translated by the score) are
 * pure GPU transforms driven by `--p` (= score/100). On the leaderboard cards
 * the fill grows from 0 as the card reveals (see the `.lb-cards` rules in
 * humanness-index.css); `fillDelayMs` matches the card cascade so each bar
 * fills in turn. Elsewhere (e.g. the detail hero) it just renders filled.
 */
export const RankScale = ({
  model,
  allModels,
  fillDelayMs = 0,
}: {
  model: ScoredModel;
  allModels: ScoredModel[];
  /** Stagger (ms) so a card's meter fills in sync with its reveal cascade. */
  fillDelayMs?: number;
}) => {
  const pct = humannessScore(model, allModels);

  return (
    <div
      className="rank-meter"
      style={
        { '--p': pct / 100, '--fill-delay': `${fillDelayMs}ms` } as CSSProperties
      }
    >
      <div
        className="rank-meter-track"
        role="img"
        aria-label={`Humanness ${pct} of 100, lower to higher`}
      >
        <span className="rank-meter-fill" />
        <span className="rank-meter-thumb-rail" aria-hidden="true">
          <span className="rank-meter-thumb" />
        </span>
      </div>
      <div className="rank-meter-ends" aria-hidden="true">
        <span>Lower</span>
        <span>Higher</span>
      </div>
    </div>
  );
};
