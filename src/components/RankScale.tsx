import { humannessScore } from '../lib/scoring';
import type { ScoredModel } from '../lib/types';

/**
 * Where this model sits low to high, as a slim filled meter. The marker tracks
 * the model's Humanness score (0 to 100), so it always agrees with the number
 * shown beside it.
 */
export const RankScale = ({
  model,
  allModels,
}: {
  model: ScoredModel;
  allModels: ScoredModel[];
}) => {
  const pct = humannessScore(model, allModels);

  return (
    <div className="rank-meter">
      <div
        className="rank-meter-track"
        role="img"
        aria-label={`Humanness ${pct} of 100, lower to higher`}
      >
        <span className="rank-meter-fill" style={{ width: `${pct}%` }} />
        <span className="rank-meter-thumb" style={{ left: `${pct}%` }} />
      </div>
      <div className="rank-meter-ends" aria-hidden="true">
        <span>Lower</span>
        <span>Higher</span>
      </div>
    </div>
  );
};
