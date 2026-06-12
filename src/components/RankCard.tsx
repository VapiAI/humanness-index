'use client';

import { useMemo, type CSSProperties } from 'react';

import { Users } from '@phosphor-icons/react';

import { voiceStats } from '../data/providers';
import { modelDetailLinkForId } from '../lib/detail';
import { humannessScore } from '../lib/scoring';
import type { ScoredModel } from '../lib/types';
import { voiceStyle } from '../lib/voiceViz';
import { DetailPageLink } from './DetailPageLink';
import { PlayIcon, StopIcon } from './icons';
import { ProviderLogo } from './ProviderLogo';
import { RankScale } from './RankScale';
import { VoiceViz } from './VoiceViz';

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

/** The art well shared by RankCard and FeaturedCard: voice viz + floating Listen pill. */
export const RankCardArt = ({ model, playing, animate, onPlay, featured = false }: RankCardArtProps) => (
  <div className={`rcard-art${featured ? ' fcard-art' : ''}${playing ? ' is-playing' : ''}`}>
    <div className="rcard-art-viz">
      <VoiceViz playing={playing} model={model} size={168} animate={animate} />
    </div>
    <button
      className="rcard-art-listen"
      type="button"
      onClick={onPlay}
      aria-label={
        playing
          ? `Stop ${model.provider} ${model.model} sample`
          : `Listen to ${model.provider} ${model.model} sample`
      }
    >
      <span className="rcard-listen-chip">
        <span className="rcard-listen-dot">{playing ? <StopIcon /> : <PlayIcon />}</span>
        <span className="rcard-listen-label">{playing ? 'Stop' : 'Listen'}</span>
      </span>
    </button>
  </div>
);

/** A Top-10 leaderboard card: rank, identity, visualizer + listen, score, stats. */
export const RankCard = ({ model, rank, playing, onPlay, allModels }: RankCardProps) => {
  const stats = voiceStats(model);
  const { provider, voiceProfile } = model;
  const { palette } = useMemo(
    () => voiceStyle({ provider, voiceProfile }),
    [provider, voiceProfile],
  );

  return (
    <article
      className="rcard tone-light"
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
      <RankCardArt model={model} playing={playing} animate={playing} onPlay={onPlay} />
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
          <dd className="rcard-votes">
            <Users size={14} weight="bold" aria-hidden="true" />
            {model.wins.toLocaleString()}
          </dd>
        </div>
      </dl>
    </article>
  );
};
