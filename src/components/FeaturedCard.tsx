'use client';

import { useMemo, type CSSProperties } from 'react';

import { modelBlurb, voiceStats } from '../data/providers';
import { humannessScore } from '../lib/scoring';
import { voiceStyle } from '../lib/voiceViz';
import { RankCardArt, RankCardIdentity, type RankCardProps } from './RankCard';
import { RankScale } from './RankScale';
import { VotesCount } from './VotesCount';

/** The #1 card — double-width hero with Vapi's editorial blurb on the leader. */
export const FeaturedCard = ({ model, rank, playing, onPlay, allModels }: RankCardProps) => {
  const stats = voiceStats(model);
  const { provider, voiceProfile } = model;
  const { palette } = useMemo(
    () => voiceStyle({ provider, voiceProfile }),
    [provider, voiceProfile],
  );

  return (
    <article
      className="rcard rcard-featured tone-light"
      style={
        {
          '--card-from': palette.from,
          '--card-mid': palette.mid,
          '--card-to': palette.to,
        } as CSSProperties
      }
    >
      <div className="fcard-top">
        <div className="fcard-graphic">
          <div className="rcard-rank">#{rank} · Humanness leader</div>
          {/* Playback-only animation; see RankCard. */}
          <RankCardArt
            model={model}
            playing={playing}
            animate={playing}
            onPlay={onPlay}
            featured
          />
        </div>
        <div className="fcard-body">
          <RankCardIdentity model={model} />
          <div className="rcard-score">
            <span className="rcard-score-label">Humanness</span>
            <span className="rcard-score-value">{humannessScore(model, allModels)}</span>
          </div>
          <RankScale model={model} allModels={allModels} />
          <dl className="fcard-stats">
            <div className="fcard-stat">
              <dt>Latency</dt>
              <dd>{stats.latency}</dd>
            </div>
            <div className="fcard-stat">
              <dt>Languages</dt>
              <dd>{stats.langs}</dd>
            </div>
            <div className="fcard-stat">
              <dt>Votes</dt>
              <dd>
                <VotesCount wins={model.wins} allWins={allModels.map((m) => m.wins)} />
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <p className="fcard-blurb">{modelBlurb(model)}</p>
    </article>
  );
};
