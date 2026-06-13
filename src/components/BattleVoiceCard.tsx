'use client';

import { Check } from '@phosphor-icons/react';
import type { CSSProperties } from 'react';

import { modelDetailLinkForId } from '../lib/detail';
import type { ScoredModel } from '../lib/types';
import { PALETTES } from '../lib/voiceViz';
import { CueGlyph } from './CueGlyph';
import { DetailPageLink } from './DetailPageLink';
import { ProviderLogo } from './ProviderLogo';
import { VoiceViz } from './VoiceViz';

type BattleVoiceCardProps = {
  model: ScoredModel;
  label: 'A' | 'B';
  playing?: boolean;
  played?: boolean;
  /** Post-vote: unmask the voice in place (identity, rank, score). */
  revealed?: boolean;
  /** This side is the listener's pick (never set on a tie vote). */
  isPick?: boolean;
  /** This side ranks higher on the Index than its opponent. */
  isLeader?: boolean;
  /** 1-based Index rank, shown once revealed. */
  rank?: number;
  /** Humanness score (0–100), shown once revealed. */
  humanness?: number;
  /** Signed Elo shift the listener's vote gave this side, shown once revealed. */
  eloDelta?: number | null;
  /** Idle only: the first card click starts the round. */
  onStart?: () => void;
  /** Play this side (or stop it if it's already speaking). */
  onTogglePlay?: () => void;
};

/**
 * One side of the blind head-to-head. The orb stays in place the whole time
 * and pulses with the live clip amplitude while this voice plays; on hover a
 * play/pause glyph fades in over it (same as the leaderboard cards).
 *
 * The surface is listen-only: idle → starts the round; afterwards every click
 * switches playback to this voice (clicking the speaking card stops it), with
 * unlimited back-and-forth. Voting lives in the explicit pick buttons below
 * the arena — a card click never casts a vote. After the vote the card stays
 * in place and reveals its real identity (provider, rank, Humanness).
 */
export const BattleVoiceCard = ({
  model,
  label,
  playing = false,
  played = false,
  revealed = false,
  isPick = false,
  isLeader = false,
  rank,
  humanness,
  eloDelta = null,
  onStart,
  onTogglePlay,
}: BattleVoiceCardProps) => {
  // Blind A/B uses two cool brand accents (fixed per side, so they never leak
  // the model's real palette): teal for A, violet for B.
  const palette = label === 'A' ? PALETTES.teal : PALETTES.violet;
  // Post-vote conversion path: the revealed name links to its model page.
  // Gated on `revealed` so the blind phase DOM stays fully anonymous — no
  // hrefs to peek at before voting.
  const revealLink = revealed ? modelDetailLinkForId(model.id) : null;
  // Listen-only surface: start the round from idle, otherwise toggle playback.
  const handleActivate = revealed ? undefined : (onStart ?? onTogglePlay);
  const clickable = typeof handleActivate === 'function';
  const surfaceLabel = clickable
    ? playing
      ? `Stop Voice ${label}`
      : `Play Voice ${label}`
    : undefined;

  const className = [
    'vcard',
    'vcard-battle',
    'tone-light',
    playing ? 'is-playing' : '',
    played && !playing && !revealed ? 'is-done' : '',
    clickable ? 'is-clickable' : '',
    revealed && isPick ? 'is-pick' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      style={
        {
          '--card-from': palette.from,
          '--card-mid': palette.mid,
          '--card-to': palette.to,
        } as CSSProperties
      }
      onClick={handleActivate}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={surfaceLabel}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleActivate?.();
              }
            }
          : undefined
      }
    >
      <div className="vcard-stage">
        <span className="vcard-side" aria-hidden="true">
          {label}
        </span>
        {revealed ? (
          <>
            {/* Corner flag: the listener's pick wins the slot; otherwise
                point out the side the Index ranks higher. */}
            {isPick ? (
              <span className="vcard-flag vcard-flag-pick">
                <Check size={12} weight="bold" /> Your pick
              </span>
            ) : (
              isLeader && <span className="vcard-flag">Ranks higher</span>
            )}
            <div className="vcard-reveal">
              {/* The provider's mark is the unmasking moment — it takes the
                  orb's spot as the revealed card's anchor. */}
              <div className="vcard-brand">
                <ProviderLogo provider={model.provider} />
              </div>
              <p className="vcard-reveal-name">
                {revealLink ? (
                  <DetailPageLink className="vcard-reveal-link" kind="model" link={revealLink}>
                    {`${model.provider} ${model.model}`}
                  </DetailPageLink>
                ) : (
                  `${model.provider} ${model.model}`
                )}
              </p>
              <div className="vcard-reveal-stats">
                <span className="vcard-reveal-chip">
                  <span className="vcard-reveal-k">Rank</span>
                  <span className="vcard-reveal-v">#{rank}</span>
                </span>
                <span className="vcard-reveal-chip">
                  <span className="vcard-reveal-k">Humanness</span>
                  <span className="vcard-reveal-v">{humanness}</span>
                </span>
                {eloDelta !== null && (
                  <span
                    className={`vcard-reveal-chip vcard-delta ${eloDelta >= 0 ? 'is-up' : 'is-down'}`}
                    title="How your vote just moved this voice's Elo rating, the score behind the rankings"
                  >
                    <span className="vcard-reveal-k">Your vote</span>
                    <span className="vcard-reveal-v">
                      {eloDelta >= 0 ? `+${eloDelta}` : eloDelta} Elo
                    </span>
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="vcard-art">
              {/* The orb stays put and pulses with the live amplitude while
                  this side plays. The corner A/B chip is the only identity
                  marker during the blind phase. */}
              <VoiceViz playing={playing} model={model} animate={playing} palette={palette} />
            </div>
            <span className="rcard-art-cue" aria-hidden="true">
              <CueGlyph paused={playing} />
            </span>
          </>
        )}
      </div>
    </div>
  );
};
