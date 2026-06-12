import type { ScoredModel } from '../lib/types';

/** Where this model's score sits across the whole field, as a bubble strip. */
export const RankScale = ({
  model,
  allModels,
}: {
  model: ScoredModel;
  allModels: ScoredModel[];
}) => {
  const elos = allModels.map((m) => m.elo);
  const min = Math.min(...elos);
  const max = Math.max(...elos);
  const pos = (elo: number) => 6 + (max > min ? (elo - min) / (max - min) : 0.5) * 88;

  return (
    <div className="rank-bubbles">
      <div className="rank-bubbles-track">
        {allModels.map((m) => (
          <span
            key={m.id}
            className={`rank-bubble${m.id === model.id ? ' is-self' : ''}`}
            style={{ left: `${pos(m.elo)}%` }}
            title={`${m.provider} ${m.model}: ${m.elo}`}
          />
        ))}
      </div>
      <div className="rank-bubbles-ends">
        <span>Lower</span>
        <span>Higher</span>
      </div>
    </div>
  );
};
