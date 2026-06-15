import { useReveal } from '../hooks/useReveal';
import type { ScoredModel } from '../lib/types';
import { FeaturedCard } from './FeaturedCard';
import { RankCard } from './RankCard';
import { Reveal } from './Reveal';

type LeaderboardSectionProps = {
  topModels: ScoredModel[];
  allModels: ScoredModel[];
  playingId: string | null;
  onTogglePlay: (model: ScoredModel) => void;
};

/** "Most Human Models" — two rows: the featured #1 card plus the next six. */
export const LeaderboardSection = ({
  topModels,
  allModels,
  playingId,
  onTogglePlay,
}: LeaderboardSectionProps) => {
  // The grid is the reveal group (children cascade via CSS). We drive it
  // directly instead of via <RevealGroup> so `inView` can flow into the cards:
  // the meter fill (CSS, gated on `.top-card-grid.is-in`) and the score
  // count-up (JS) then share one trigger and stay in sync.
  const { ref, inView } = useReveal<HTMLDivElement>({ rootMargin: '0px 0px 0px 0px' });

  return (
    <section className="leaderboard-section" id="leaderboard">
      <Reveal as="div" className="section-heading">
        <h2>Most Human Models</h2>
      </Reveal>
      <div
        ref={ref}
        className={`top-card-grid reveal-group${inView ? ' is-in' : ''}`}
      >
        {topModels.map((model, index) => {
          const CardComponent = index === 0 ? FeaturedCard : RankCard;
          return (
            <CardComponent
              key={model.id}
              model={model}
              rank={index + 1}
              playing={playingId === model.id}
              onPlay={() => onTogglePlay(model)}
              allModels={allModels}
              animateIn={inView}
            />
          );
        })}
      </div>
    </section>
  );
};
