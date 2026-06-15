import type { ScoredModel } from '../lib/types';
import { FeaturedCard } from './FeaturedCard';
import { RankCard } from './RankCard';
import { Reveal, RevealGroup } from './Reveal';

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
}: LeaderboardSectionProps) => (
  <section className="leaderboard-section" id="leaderboard">
    <Reveal as="div" className="section-heading">
      <h2>Most Human Models</h2>
    </Reveal>
    <RevealGroup as="div" className="top-card-grid">
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
          />
        );
      })}
    </RevealGroup>
  </section>
);
