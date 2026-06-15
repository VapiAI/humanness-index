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
  // Two reveal rows, each its own reveal group + IntersectionObserver, so on
  // desktop the second row (#4-#7) fades in as its own beat when it scrolls in
  // rather than as a tail of the top row's cascade. Each row drives its own
  // cards' meter fill (CSS, gated on the row's `is-in`) and count-up (the
  // `animateIn` flag) off the same trigger, so they stay in sync per row.
  //
  // On mobile the second row is hidden in CSS (the podium shows the top 3), so
  // this naturally collapses to a single cascade with no awkward split.
  const topRow = useReveal<HTMLDivElement>({ rootMargin: '0px 0px 0px 0px' });
  const secondRow = useReveal<HTMLDivElement>();

  const topCards = topModels.slice(0, 3);
  const secondCards = topModels.slice(3);

  return (
    <section className="leaderboard-section" id="leaderboard">
      <Reveal as="div" className="section-heading">
        <h2>Most Human Models</h2>
      </Reveal>
      {/* The podium effectively announces the winners, so while voting is live the
          cards are blurred behind a labeled scrim. The cards stay in the DOM/SSR
          (so crawlers still read the standings) but are `inert`: out of the tab
          order and the accessibility tree, with the veil's copy read in their
          place. This also intentionally hides the card reveal animations for now. */}
      <div className="lb-provisional">
        <div className="lb-provisional-cards" inert>
          <div
            ref={topRow.ref}
            className={`lb-cards lb-cards--top reveal-group${topRow.inView ? ' is-in' : ''}`}
          >
            {topCards.map((model, index) => {
              const CardComponent = index === 0 ? FeaturedCard : RankCard;
              return (
                <CardComponent
                  key={model.id}
                  model={model}
                  rank={index + 1}
                  revealIndex={index}
                  playing={playingId === model.id}
                  onPlay={() => onTogglePlay(model)}
                  allModels={allModels}
                  animateIn={topRow.inView}
                />
              );
            })}
          </div>
          {secondCards.length > 0 && (
            <div
              ref={secondRow.ref}
              className={`lb-cards lb-cards--rest reveal-group${secondRow.inView ? ' is-in' : ''}`}
            >
              {secondCards.map((model, index) => (
                <RankCard
                  key={model.id}
                  model={model}
                  rank={index + 4}
                  revealIndex={index}
                  playing={playingId === model.id}
                  onPlay={() => onTogglePlay(model)}
                  allModels={allModels}
                  animateIn={secondRow.inView}
                />
              ))}
            </div>
          )}
        </div>
        <div className="lb-provisional-veil" role="note">
          <span className="lb-provisional-pill">
            <span className="lb-provisional-dot" aria-hidden="true" />
            Voting in progress
          </span>
          <p className="lb-provisional-title">Rankings are provisional</p>
          <p className="lb-provisional-sub">
            We&apos;re keeping the podium under wraps while the votes come in. Listen and
            vote above, and the most human models reveal once the standings settle.
          </p>
        </div>
      </div>
    </section>
  );
};
