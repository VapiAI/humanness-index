'use client';

import type { CSSProperties } from 'react';

import {
  ArrowDown,
  ArrowsCounterClockwise,
  ArrowUpRight,
  Check,
  FileText,
} from '@phosphor-icons/react';

import { revealHeadline } from '../lib/scoring';
import type {
  BattleSide,
  RoundPhase,
  RoundReveal,
  ScoredModel,
  VoteChoice,
} from '../lib/types';
import { BattleVoiceCard } from './BattleVoiceCard';
import { PlayIcon } from './icons';
import { Reveal, RevealGroup } from './Reveal';
import { METHODOLOGY_URL } from './shell/SiteNav';

type HeroSectionProps = {
  /** The post-vote reveal, or null while the round is blind. */
  reveal: RoundReveal | null;
  roundPhase: RoundPhase;
  /**
   * The line both voices read this round. Identity-free (same prompt on both
   * sides), so it is safe to show in the blind round as a read-along caption.
   */
  promptText: string;
  playedSides: Record<BattleSide, boolean>;
  /** Which side is currently playing (blind side tracking, no identities). */
  playingSide: BattleSide | null;
  /** Both voices have started playing — voting is enabled. */
  canVote: boolean;
  /**
   * Seconds left before the post-vote auto-advance (shown counting down in the
   * Next button), or null when no countdown is running.
   */
  autoAdvanceIn?: number | null;
  /** Total auto-advance window in ms — drives the Next button's progress bar. */
  autoAdvanceMs?: number;
  onPlayRound: () => void;
  onToggleSide: (side: BattleSide) => void;
  onVote: (choice: VoteChoice) => void;
  onNext: () => void;
};

/**
 * The hero: page intro on the left, the blind "voice vs. voice" picker on the
 * right. The cards are blind until the vote (audio only, fixed A/B styling, no
 * identities). After the vote, the reveal — built entirely from the vote
 * response — unmasks both cards in place with no layout change.
 */
export const HeroSection = ({
  reveal,
  roundPhase,
  promptText,
  playedSides,
  playingSide,
  canVote,
  autoAdvanceIn = null,
  autoAdvanceMs,
  onPlayRound,
  onToggleSide,
  onVote,
  onNext,
}: HeroSectionProps) => {
  const revealed = reveal !== null;
  // Read-along: show the shared line as soon as the battle loads — from the
  // blind/idle state, before any play — and keep it through play and reveal.
  // One caption for both sides (they read the same prompt); it never carries
  // any model identity, so it is safe in the blind round. The displayed text is
  // trimmed to a tidy excerpt in CSS; the audio still plays the full line.
  const showReadAlong = Boolean(promptText);
  const roundResult: VoteChoice | null = reveal?.winner ?? null;
  const pickedSide: BattleSide | null =
    roundResult === 'tie' ? null : roundResult;

  // Reveal-only derivations: identities arrive with the vote, never before.
  const leaderSide: BattleSide | null = reveal
    ? reveal.left.model.elo >= reveal.right.model.elo
      ? 'left'
      : 'right'
    : null;
  // Provider + model, except the Human baseline reads as just its model name.
  const modelName = (model: ScoredModel) =>
    model.baseline ? model.model : `${model.provider} ${model.model}`;
  // Which side (if any) was the real Human recording, the voice the listener
  // picked, and the crowd-favored (higher-Elo) voice — all from the reveal.
  const humanSide: BattleSide | null = reveal
    ? reveal.left.model.baseline
      ? 'left'
      : reveal.right.model.baseline
        ? 'right'
        : null
    : null;
  const pickedModel = reveal
    ? roundResult === 'left'
      ? reveal.left.model
      : roundResult === 'right'
        ? reveal.right.model
        : null
    : null;
  // The crowd-favored voice is judged on PRE-vote standings (the server's
  // `correct`): when the pick agreed it is the picked side, otherwise the other
  // side. Derived from `correct` rather than post-vote Elo, which a close vote
  // can flip — so the headline always matches the correct/incorrect verdict.
  const crowdModel =
    reveal && roundResult !== 'tie'
      ? reveal.correct
        ? pickedModel
        : roundResult === 'left'
          ? reveal.right.model
          : reveal.left.model
      : null;

  const headingText = reveal
    ? revealHeadline({
        winner: reveal.winner,
        correct: reveal.correct,
        humanSide,
        pickedName: pickedModel ? modelName(pickedModel) : null,
        crowdName: crowdModel ? modelName(crowdModel) : '',
      })
    : 'Which voice sounds more human?';
  const hintText = revealed
    ? "Here's who you were listening to."
    : 'Same voice, different models.';

  const handleSeeLeaderboard = () => {
    // Jump to the Humanness Rankings (dot distribution chart + full rankings
    // table), not the highlight cards.
    document.getElementById('rankings')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="lab-hero">
      <RevealGroup as="div" className="lab-copy">
        <p className="hero-eyebrow">The Humanness Index™</p>
        <h1 className="hero-title">Which voice model sounds the most human?</h1>
        <p className="hero-note">
          Sounding human is hard to measure, but it&apos;s what decides whether a call
          works. We clone one voice onto every model and play them blind against a real
          human, so you can hear which ones pass.
        </p>
        {/* Until a formal whitepaper ships, the methodology doc is the source. */}
        <a
          className="vapi-btn hero-cta"
          href={METHODOLOGY_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <FileText size={16} weight="bold" aria-hidden="true" />
          Read the whitepaper
          <ArrowUpRight
            size={14}
            weight="bold"
            aria-hidden="true"
            className="hero-cta-ext"
          />
        </a>
      </RevealGroup>

      <Reveal as="div" className="lab-card" delay={140}>
        <header className="lab-head">
          <h2 className="lab-question">{headingText}</h2>
          <p className="lab-hint">{hintText}</p>
        </header>

        {showReadAlong && (
          <figure className="lab-readalong">
            <figcaption className="lab-readalong-label">Read along</figcaption>
            {/* The full line is in the DOM (announced to screen readers); CSS
                trims the visible text to a two-line excerpt. */}
            <blockquote className="lab-readalong-quote">{promptText}</blockquote>
          </figure>
        )}

        <div className="lab-arena">
          <BattleVoiceCard
            label="A"
            playing={playingSide === 'left'}
            played={playedSides.left}
            revealed={revealed}
            isPick={pickedSide === 'left'}
            isLeader={leaderSide === 'left'}
            model={reveal?.left.model}
            rank={reveal?.left.rank}
            humanness={reveal?.left.humanness}
            eloDelta={reveal?.left.eloDelta ?? null}
            onTogglePlay={() => onToggleSide('left')}
          />
          <div className="lab-vs">
            <span className="lab-vs-text">
              {revealed && roundResult === 'tie' ? 'tie' : 'vs'}
            </span>
          </div>
          <BattleVoiceCard
            label="B"
            playing={playingSide === 'right'}
            played={playedSides.right}
            revealed={revealed}
            isPick={pickedSide === 'right'}
            isLeader={leaderSide === 'right'}
            model={reveal?.right.model}
            rank={reveal?.right.rank}
            humanness={reveal?.right.humanness}
            eloDelta={reveal?.right.eloDelta ?? null}
            onTogglePlay={() => onToggleSide('right')}
          />
        </div>

        <div className="lab-controls">
          {revealed ? (
            <div className="lab-after">
              {/* Auto-advances at 0; a click (or space) advances immediately and
                  cancels the countdown. The label keeps a stable accessible name
                  ("Next pair") so the per-second tick doesn't spam screen
                  readers; the (n) and the progress fill are decorative. */}
              <button
                className="lab-primary lab-next"
                type="button"
                onClick={onNext}
                aria-label="Next pair"
                style={
                  autoAdvanceMs
                    ? ({ '--auto-advance-ms': `${autoAdvanceMs}ms` } as CSSProperties)
                    : undefined
                }
              >
                {autoAdvanceMs != null && (
                  <span className="lab-next-progress" aria-hidden="true" />
                )}
                <span className="lab-next-label">
                  <ArrowsCounterClockwise size={18} weight="bold" aria-hidden="true" />
                  Next pair
                  {autoAdvanceIn != null && (
                    <span className="lab-next-count" aria-hidden="true">
                      {' '}
                      ({autoAdvanceIn})
                    </span>
                  )}
                </span>
              </button>
              <button className="lab-ghost" type="button" onClick={handleSeeLeaderboard}>
                <ArrowDown size={16} weight="bold" /> See the leaderboard
              </button>
            </div>
          ) : roundPhase === 'idle' ? (
            <button className="lab-primary" type="button" onClick={onPlayRound}>
              <PlayIcon />
              Start: Listen and Vote
            </button>
          ) : (
            /* Buttons appear as soon as the round starts, but stay disabled
               until the listener has heard the start of both voices. */
            <div className="lab-pick">
              <button
                className="lab-pick-btn lab-pick-a"
                type="button"
                disabled={!canVote}
                onClick={() => onVote('left')}
              >
                <Check size={18} weight="bold" /> Pick A
              </button>
              <button
                className="lab-tie-btn"
                type="button"
                disabled={!canVote}
                onClick={() => onVote('tie')}
              >
                It&apos;s a tie
              </button>
              <button
                className="lab-pick-btn lab-pick-b"
                type="button"
                disabled={!canVote}
                onClick={() => onVote('right')}
              >
                <Check size={18} weight="bold" /> Pick B
              </button>
            </div>
          )}
          <p className="lab-keys">
            <kbd>←</kbd>
            <kbd>→</kbd> play each side · <kbd>space</kbd> vote, then next pair
          </p>
        </div>
      </Reveal>
    </section>
  );
};
