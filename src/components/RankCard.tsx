'use client';

import { useRouter } from 'next/navigation';
import { useMemo, type CSSProperties, type MouseEvent } from 'react';

import { voiceStats } from '../data/providers';
import { trackDetailLinkClicked } from '../lib/analytics';
import { modelDetailLinkForId } from '../lib/detail';
import { humannessScore } from '../lib/scoring';
import type { ScoredModel } from '../lib/types';
import { orbSquareness, voiceStyle } from '../lib/voiceViz';
import { CueGlyph } from './CueGlyph';
import { DetailPageLink } from './DetailPageLink';
import { ProviderLogo } from './ProviderLogo';
import { RankScale } from './RankScale';
import { VoiceViz } from './VoiceViz';
import { VotesCount } from './VotesCount';

export type RankCardProps = {
  model: ScoredModel;
  rank: number;
  playing: boolean;
  onPlay: () => void;
  allModels: ScoredModel[];
};

type RankCardArtProps = {
  model: ScoredModel;
  playing: boolean;
  animate: boolean;
  onPlay: () => void;
  featured?: boolean;
  /** Orb shape from the model's Humanness: 0 round (human) → 1 rounded-square. */
  squareness?: number;
  /** Stagger (ms) for the orb's one-time entrance, so the grid cascades in. */
  enterDelay?: number;
};

/**
 * Identity block shared by RankCard and FeaturedCard. When the model has a
 * detail page, the name block becomes a discrete link to it — stopPropagation
 * keeps the card's own surfaces (art = play button, hover states) untouched.
 * Rows without a listed registry entry stay plain text.
 */
export const RankCardIdentity = ({ model }: { model: ScoredModel }) => {
  const detailLink = modelDetailLinkForId(model.id);
  const nameBlock = (
    <>
      <div className="rcard-name">{model.provider}</div>
      <div className="rcard-model">{model.model}</div>
    </>
  );
  return (
    <div className="rcard-id">
      <ProviderLogo provider={model.provider} />
      {detailLink ? (
        <DetailPageLink className="rcard-id-text rcard-link" kind="model" link={detailLink}>
          {nameBlock}
        </DetailPageLink>
      ) : (
        <div className="rcard-id-text">{nameBlock}</div>
      )}
    </div>
  );
};

/**
 * Whole-tile navigation to the model's detail page (the cards already carry a
 * hover state). The name link inside stays the crawlable path; this hook adds
 * the bigger click target. Clicks on interactive children (Listen, links) are
 * theirs alone. Returns undefined for unlisted models, leaving the tile inert.
 */
export const useCardNavigation = (model: ScoredModel) => {
  const router = useRouter();
  const detailLink = modelDetailLinkForId(model.id);
  if (!detailLink) return undefined;
  return (event: MouseEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, a')) return;
    trackDetailLinkClicked({ kind: 'model', slug: detailLink.slug });
    router.push(detailLink.path);
  };
};

/**
 * The art well shared by RankCard, FeaturedCard, and the detail SamplePlayer:
 * the whole orb is the play/stop button (no separate pill). On hover the orb
 * springs up and a play/stop glyph fades in; while playing the mint ring marks
 * the state and the pulsing orb carries the motion.
 */
export const RankCardArt = ({
  model,
  playing,
  animate,
  onPlay,
  featured = false,
  squareness = 0,
  enterDelay = 0,
}: RankCardArtProps) => (
  <button
    type="button"
    className={`rcard-art${featured ? ' fcard-art' : ''}${playing ? ' is-playing' : ''}`}
    onClick={onPlay}
    aria-label={
      playing
        ? `Stop ${model.provider} ${model.model} sample`
        : `Listen to ${model.provider} ${model.model} sample`
    }
  >
    <span className="rcard-art-viz">
      <VoiceViz
        playing={playing}
        model={model}
        size={168}
        animate={animate}
        squareness={squareness}
        enterDelay={enterDelay}
      />
    </span>
    <span className="rcard-art-cue" aria-hidden="true">
      <CueGlyph paused={playing} />
    </span>
  </button>
);

/** A Top-10 leaderboard card: rank, identity, visualizer + listen, score, stats. */
export const RankCard = ({ model, rank, playing, onPlay, allModels }: RankCardProps) => {
  const stats = voiceStats(model);
  const handleCardClick = useCardNavigation(model);
  const { provider, voiceProfile } = model;
  const { palette } = useMemo(
    () => voiceStyle({ provider, voiceProfile }),
    [provider, voiceProfile],
  );

  return (
    <article
      className={`rcard tone-light${handleCardClick ? ' is-linked' : ''}`}
      onClick={handleCardClick}
      style={
        {
          '--card-from': palette.from,
          '--card-mid': palette.mid,
          '--card-to': palette.to,
        } as CSSProperties
      }
    >
      <div className="rcard-rank">#{rank}</div>
      <RankCardIdentity model={model} />
      {/* The viz animates only during playback: hover-started animation made
          the canvas spin up right as the pointer crossed cards mid-scroll. */}
      <RankCardArt
        model={model}
        playing={playing}
        animate={playing}
        onPlay={onPlay}
        squareness={orbSquareness(humannessScore(model, allModels))}
        enterDelay={(rank - 1) * 140}
      />
      <div className="rcard-score">
        <span className="rcard-score-label">Humanness</span>
        <span className="rcard-score-value">{humannessScore(model, allModels)}</span>
      </div>
      <RankScale model={model} allModels={allModels} />
      <dl className="rcard-stats">
        <div>
          <dt>Latency</dt>
          <dd>{stats.latency}</dd>
        </div>
        <div>
          <dt>Languages</dt>
          <dd>{stats.langs}</dd>
        </div>
        <div>
          <dt>Votes</dt>
          <dd>
            <VotesCount wins={model.wins} allWins={allModels.map((m) => m.wins)} />
          </dd>
        </div>
      </dl>
    </article>
  );
};
