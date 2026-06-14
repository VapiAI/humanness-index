'use client';

import { ArrowDown, ArrowsCounterClockwise, Check } from '@phosphor-icons/react';

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
import { METHODOLOGY_URL } from './shell/SiteNav';

type HeroSectionProps = {
  /** The post-vote reveal, or null while the round is blind. */
  reveal: RoundReveal | null;
  roundPhase: RoundPhase;
  playedSides: Record<BattleSide, boolean>;
  /** Which side is currently playing (blind side tracking, no identities). */
  playingSide: BattleSide | null;
  /** Both voices have started playing — voting is enabled. */
  canVote: boolean;
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
  playedSides,
  playingSide,
  canVote,
  onPlayRound,
  onToggleSide,
  onVote,
  onNext,
}: HeroSectionProps) => {
  const revealed = reveal !== null;
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
    // Jump to the Humanness Deep Dive (dot distribution chart + full rankings
    // table), not the highlight cards.
    document.getElementById('rankings')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="lab-hero">
      <div className="lab-copy">
        <p className="hero-eyebrow">The Humanness Index™</p>
        <h1 className="hero-title">How human does your voice AI really sound?</h1>
        <p className="hero-note">
          In conversation, the only thing that matters is whether the voice feels like a
          real person. We clone one voice onto every model and play them blind against a
          real human, so the score reflects the model, not the clip.
        </p>
        {/* Until a formal whitepaper ships, the methodology doc is the source. */}
        <a
          className="vapi-btn hero-cta"
          href={METHODOLOGY_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          Read the whitepaper
        </a>
      </div>

      <div className="lab-card">
        <header className="lab-head">
          <h2 className="lab-question">{headingText}</h2>
          <p className="lab-hint">{hintText}</p>
        </header>

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
              <button className="lab-primary lab-next" type="button" onClick={onNext}>
                <ArrowsCounterClockwise size={18} weight="bold" /> Next Pair
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
      </div>
    </section>
  );
};
