'use client';

import { ArrowDown, ArrowsCounterClockwise, Check } from '@phosphor-icons/react';

import { humannessScore, resultHeading } from '../lib/scoring';
import type {
  BattleSide,
  HeroBattle,
  RoundPhase,
  ScoredModel,
  VoteChoice,
} from '../lib/types';
import { BattleVoiceCard } from './BattleVoiceCard';
import { PlayIcon } from './icons';
import { METHODOLOGY_URL } from './shell/SiteNav';

type HeroSectionProps = {
  battle: HeroBattle;
  leftModel: ScoredModel;
  rightModel: ScoredModel;
  sortedModels: ScoredModel[];
  roundPhase: RoundPhase;
  playedSides: Record<BattleSide, boolean>;
  playingId: string | null;
  promptProgress: number;
  revealed: boolean;
  roundResult: VoteChoice | null;
  /** Both voices have started playing — voting is enabled. */
  canVote: boolean;
  /** Whether the revealed pick agreed with the crowd consensus. */
  voteCorrect: boolean;
  /** Signed Elo shifts the listener's vote produced, by card side. */
  voteImpact: { left: number; right: number } | null;
  onPlayRound: () => void;
  onToggleSide: (side: BattleSide) => void;
  onVote: (choice: VoteChoice) => void;
  onNext: () => void;
};

/**
 * The hero: page intro on the left, the blind "voice vs. voice" picker on the
 * right. The two battle cards are the one fixed stage for the whole round —
 * cards are listen-only (click to play/switch), voting happens in the pick
 * buttons, and the post-vote reveal unmasks both cards in place with no
 * layout change.
 */
export const HeroSection = ({
  battle,
  leftModel,
  rightModel,
  sortedModels,
  roundPhase,
  playedSides,
  playingId,
  promptProgress,
  revealed,
  roundResult,
  canVote,
  voteCorrect,
  voteImpact,
  onPlayRound,
  onToggleSide,
  onVote,
  onNext,
}: HeroSectionProps) => {
  const leaderSide: BattleSide = leftModel.elo >= rightModel.elo ? 'left' : 'right';
  const leaderModel = leaderSide === 'left' ? leftModel : rightModel;
  const pickedSide: BattleSide | null = roundResult === 'tie' ? null : roundResult;
  const rankOf = (model: ScoredModel) =>
    sortedModels.findIndex((m) => m.id === model.id) + 1;

  const headingText = revealed
    ? resultHeading({
        correct: voteCorrect,
        tie: roundResult === 'tie',
        leaderName: `${leaderModel.provider} ${leaderModel.model}`,
      })
    : 'Which one is human?';
  const hintText = revealed
    ? "Here's who you were listening to."
    : 'Listen to both blind samples, then cast your vote.';

  const signed = (delta: number) => (delta >= 0 ? `+${delta}` : `${delta}`);
  const handleSeeLeaderboard = () => {
    document.getElementById('leaderboard')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="lab-hero">
      <div className="lab-copy">
        <p className="hero-eyebrow">The Humanness Index™</p>
        <h1 className="hero-title">How human does your voice AI really sound?</h1>
        <p className="hero-note">
          Humanness is how much a voice feels like a real person. Help rank the models with
          your preferences.
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
          {revealed && voteImpact && (
            <p className="lab-impact">
              Your vote moved the scores: A{' '}
              <strong className={voteImpact.left >= 0 ? 'is-up' : 'is-down'}>
                {signed(voteImpact.left)}
              </strong>{' '}
              · B{' '}
              <strong className={voteImpact.right >= 0 ? 'is-up' : 'is-down'}>
                {signed(voteImpact.right)}
              </strong>{' '}
              Elo
            </p>
          )}
        </header>

        <div className="lab-arena">
          <BattleVoiceCard
            label="A"
            model={leftModel}
            playing={playingId === leftModel.id}
            played={playedSides.left}
            prompt={battle.prompt}
            progress={promptProgress}
            revealed={revealed}
            isPick={pickedSide === 'left'}
            isLeader={leaderSide === 'left'}
            rank={rankOf(leftModel)}
            humanness={humannessScore(leftModel, sortedModels)}
            onStart={roundPhase === 'idle' ? onPlayRound : undefined}
            onTogglePlay={() => onToggleSide('left')}
          />
          <div className="lab-vs">
            <span className="lab-vs-text">
              {revealed && roundResult === 'tie' ? 'tie' : 'vs'}
            </span>
          </div>
          <BattleVoiceCard
            label="B"
            model={rightModel}
            playing={playingId === rightModel.id}
            played={playedSides.right}
            prompt={battle.prompt}
            progress={promptProgress}
            revealed={revealed}
            isPick={pickedSide === 'right'}
            isLeader={leaderSide === 'right'}
            rank={rankOf(rightModel)}
            humanness={humannessScore(rightModel, sortedModels)}
            onStart={roundPhase === 'idle' ? onPlayRound : undefined}
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
        </div>
      </div>
    </section>
  );
};
