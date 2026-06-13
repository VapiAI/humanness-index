'use client';

import { Check } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';

import { modelDetailLinkForId } from '../lib/detail';
import type { ScoredModel } from '../lib/types';
import { PALETTES } from '../lib/voiceViz';
import { DetailPageLink } from './DetailPageLink';
import { ProviderLogo } from './ProviderLogo';
import { VoiceViz } from './VoiceViz';

type BattleVoiceCardProps = {
  model: ScoredModel;
  label: 'A' | 'B';
  playing?: boolean;
  played?: boolean;
  prompt: string;
  progress?: number;
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
 * One side of the blind head-to-head. While its voice plays, the card flips
 * to a "reading" face that typewrites the prompt in sync with the audio.
 *
 * The surface is listen-only: idle → starts the round; afterwards every click
 * switches playback to this voice (clicking the speaking card stops it), with
 * unlimited back-and-forth. Voting lives in the explicit pick buttons below
 * the arena — a card click never casts a vote. After the vote the card stays
 * in place and reveals its real identity (provider, rank, Humanness).
 * Mirrors the Figma's two-sided color story: Voice A teal, Voice B orange.
 */
export const BattleVoiceCard = ({
  model,
  label,
  playing = false,
  played = false,
  prompt,
  progress = 0,
  revealed = false,
  isPick = false,
  isLeader = false,
  rank,
  humanness,
  eloDelta = null,
  onStart,
  onTogglePlay,
}: BattleVoiceCardProps) => {
  const palette = label === 'A' ? PALETTES.teal : PALETTES.sunset;
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

  // The whole prompt is laid out invisibly up front (so nothing reflows), and
  // each character fades in as the audio progress sweeps past it.
  const typedLen = playing && prompt ? Math.round(progress * prompt.length) : 0;
  const promptChars = useMemo(() => Array.from(prompt), [prompt]);
  const scriptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = scriptRef.current;
    if (!node || prompt.length === 0) return;
    // Track the fade's leading edge through any overflow.
    node.scrollTop = (node.scrollHeight - node.clientHeight) * (typedLen / prompt.length);
  }, [typedLen, prompt.length]);

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
      <div className="vcard-flip">
        <div className="vcard-face vcard-front">
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
                    viz circle's spot as the revealed card's anchor. */}
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
                      title="How your vote moved this voice's Elo score"
                    >
                      <span className="vcard-reveal-k">Your vote</span>
                      <span className="vcard-reveal-v">
                        {eloDelta >= 0 ? `+${eloDelta}` : eloDelta}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="vcard-art">
              {/* Static while idle (the flip's back face owns the playing
                  visual). The corner A/B chip is the only identity marker. */}
              <VoiceViz playing={playing} model={model} animate={false} palette={palette} />
            </div>
          )}
        </div>
        <div className="vcard-face vcard-back" aria-hidden={!playing}>
          <div className="vcard-script-head">
            <span className="vcard-script-label">Reading Aloud</span>
          </div>
          <div className="vcard-script" ref={scriptRef}>
            <p className="vcard-script-text">
              <span className="sr-only">{prompt}</span>
              <span aria-hidden="true">
                {promptChars.map((char, index) => (
                  <span
                    key={`ch-${index}`}
                    className={
                      index < typedLen ? 'vcard-script-char is-on' : 'vcard-script-char'
                    }
                  >
                    {char}
                  </span>
                ))}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
