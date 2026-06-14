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
  label: 'A' | 'B';
  playing?: boolean;
  played?: boolean;
  /** Post-vote: unmask the voice in place (identity, rank, score). */
  revealed?: boolean;
  /** This side is the listener's pick (never set on a tie vote). */
  isPick?: boolean;
  /** This side ranks higher on the Index than its opponent. */
  isLeader?: boolean;
  /** The revealed model — only present after the vote (the card is blind before). */
  model?: ScoredModel;
  /** 1-based competitor rank, shown once revealed (baseline shows "Baseline"). */
  rank?: number;
  /** Humanness score (0–100), shown once revealed. */
  humanness?: number;
  /** Signed Elo shift the listener's vote gave this side, shown once revealed. */
  eloDelta?: number | null;
  /** Play this side (or stop it if it's already speaking). From idle, this
   *  opens the round in manual mode on this side. */
  onTogglePlay?: () => void;
};

// Fixed blind orb fingerprint per side, so the pre-vote viz never derives from
// (and so never leaks) the real model — side A and side B just look like A and B.
const BLIND_VIZ: Record<'A' | 'B', Pick<ScoredModel, 'provider' | 'voiceProfile'>> = {
  A: { provider: '', voiceProfile: 7 },
  B: { provider: '', voiceProfile: 13 },
};

/**
 * One side of the blind head-to-head. Blind until the vote: a fixed A/B accent
 * and a generic orb pulsing with the live clip amplitude, with NO model
 * identity in the DOM. After the vote it reveals the real identity (provider,
 * rank, Humanness, Elo shift) supplied by the vote response.
 */
export const BattleVoiceCard = ({
  label,
  playing = false,
  played = false,
  revealed = false,
  isPick = false,
  isLeader = false,
  model,
  rank,
  humanness,
  eloDelta = null,
  onTogglePlay,
}: BattleVoiceCardProps) => {
  // Blind A/B uses two cool brand accents (fixed per side, so they never leak
  // the model's real palette): teal for A, violet for B.
  const palette = label === 'A' ? PALETTES.teal : PALETTES.violet;
  // Post-vote conversion path: the revealed name links to its model page.
  const revealLink = revealed && model ? modelDetailLinkForId(model.id) : null;
  // The Human baseline's provider and model are both "Human"; show it once.
  const revealName = model
    ? model.baseline
      ? model.model
      : `${model.provider} ${model.model}`
    : '';
  // Listen-only surface: every click plays/switches to this side. Gated on
  // `revealed` so the blind DOM stays fully anonymous (no hrefs to peek at).
  const handleActivate = revealed ? undefined : onTogglePlay;
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
      // Don't take focus on click, so clicking to play and then using the
      // arrow-key fast mode doesn't leave the card focus-visible (outlined).
      onMouseDown={clickable ? (event) => event.preventDefault() : undefined}
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
        {revealed && model ? (
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
                    {revealName}
                  </DetailPageLink>
                ) : (
                  revealName
                )}
              </p>
              <div className="vcard-reveal-stats">
                <span className="vcard-reveal-chip">
                  <span className="vcard-reveal-k">Rank</span>
                  <span className="vcard-reveal-v">
                    {model.baseline ? 'Baseline' : `#${rank}`}
                  </span>
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
              {/* Blind orb: a fixed per-side fingerprint pulsing with the live
                  amplitude. The corner A/B chip is the only identity marker. */}
              <VoiceViz
                playing={playing}
                model={BLIND_VIZ[label]}
                animate={playing}
                palette={palette}
              />
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
