'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import './styles/tokens.css';
import './styles/humanness-index.css';

import { CtaBand } from './components/CtaBand';
import { HeroSection } from './components/HeroSection';
import { HowItWorks } from './components/HowItWorks';
import { LeaderboardSection } from './components/LeaderboardSection';
import { PiecesSection } from './components/PiecesSection';
import { RankingsSection } from './components/RankingsSection';
import { WhyThisExists } from './components/WhyThisExists';
import { useArenaAudio } from './hooks/useArenaAudio';
import { useArenaData } from './hooks/useArenaData';
import { useVoteGate } from './hooks/useVoteGate';
import { voiceStats } from './data/providers';
import { trackRoundStarted, trackVote } from './lib/analytics';
import { parseLatencyMs } from './lib/scoring';
import type {
  BattleSide,
  RoundReveal,
  ScoredModel,
  TableSort,
  TableSortKey,
  VoteChoice,
} from './lib/types';

/** Display price ('$15', 'Open source', dash) → sortable number, or null. */
const parsePriceUsd = (model: ScoredModel): number | null => {
  const match = voiceStats(model).price.match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
};

/** Fresh-column direction: metrics where "best" is big start descending. */
const DEFAULT_SORT_DIR: Record<TableSortKey, 'asc' | 'desc'> = {
  rank: 'asc',
  provider: 'asc',
  humanness: 'desc',
  elo: 'desc',
  latency: 'asc',
  price: 'asc',
  votes: 'desc',
};

/**
 * Sort the filtered standings for the table. Models without a value for the
 * active column (unmeasured latency, unpriced open source) sink to the
 * bottom in BOTH directions; ties fall back to the standing order.
 */
const sortTableRows = (rows: ScoredModel[], sort: TableSort): ScoredModel[] => {
  const value = (model: ScoredModel): number | string | null => {
    switch (sort.key) {
      case 'provider':
        return model.provider.toLowerCase();
      case 'latency':
        return parseLatencyMs(model);
      case 'price':
        return parsePriceUsd(model);
      case 'votes':
        return model.wins;
      // Rank, Humanness, and the Elo column all sort on the backing Elo.
      case 'rank':
      case 'humanness':
      case 'elo':
        return model.elo;
    }
  };
  const flip = sort.dir === 'asc' ? 1 : -1;
  // Rank #1 is the highest Elo, so ascending rank descends by value.
  const dir = sort.key === 'rank' ? -flip : flip;
  return [...rows].sort((a, b) => {
    // The Human baseline is always the top row, regardless of the active sort.
    if (Boolean(a.baseline) !== Boolean(b.baseline)) return a.baseline ? -1 : 1;
    const av = value(a);
    const bv = value(b);
    if (av === null || bv === null) {
      if (av === null && bv === null) return b.elo - a.elo;
      return av === null ? 1 : -1;
    }
    const cmp =
      typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : 0;
    return cmp * dir || b.elo - a.elo;
  });
};

/**
 * Blind side placeholders for the two battle cards. A live battle carries no
 * identities, so the cards play and track by SIDE: these give the audio engine
 * a stable per-side id (and a neutral fallback voice). The visible blind orb
 * uses its own fixed per-side seed inside BattleVoiceCard. Post-vote, the cards
 * render the real revealed models from the vote response instead.
 */
const blindSide = (id: string, voiceProfile: number): ScoredModel => ({
  id,
  provider: '',
  model: '',
  elo: 0,
  uncertainty: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  likelyRank: '',
  voiceProfile,
});
const BLIND_LEFT = blindSide('battle-left', 7);
const BLIND_RIGHT = blindSide('battle-right', 13);

/**
 * Rapid-fire pacing: after a vote, hold the reveal this long, then auto-advance
 * to the next pair and auto-play it (no "Next Pair" click needed). Long enough
 * to read the reveal and replay, short enough to keep the loop moving.
 */
const REVEAL_HOLD_MS = 1500;

export const HumannessIndexPage = () => {
  const arena = useArenaData();
  const audio = useArenaAudio();
  const voteGate = useVoteGate();

  const [reveal, setReveal] = useState<RoundReveal | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [focusedModelId, setFocusedModelId] = useState<string | null>(null);
  const [tableSort, setTableSort] = useState<TableSort>({ key: 'rank', dir: 'asc' });

  const revealed = reveal !== null;

  // Stop any clip that's still playing the moment the vote flips to the reveal view.
  useEffect(() => {
    if (revealed) audio.stopPlayback();
  }, [revealed, audio.stopPlayback]);

  const { models, sortedModels, battle: currentBattle } = arena;

  // The Human baseline is a reference, not a competitor: keep it out of the
  // provider filter, the highlight cards, and the default battle fallback.
  const rankedModels = useMemo(
    () => sortedModels.filter((model) => !model.baseline),
    [sortedModels],
  );

  // Two grid rows: the double-width #1 card plus six rank cards.
  const topModels = rankedModels.slice(0, 7);

  // The blind cards play/track by side (no identities pre-vote).
  const playingSide: BattleSide | null =
    audio.playingId === BLIND_LEFT.id
      ? 'left'
      : audio.playingId === BLIND_RIGHT.id
        ? 'right'
        : null;

  // Blind-test integrity is enforced server-side: every sample carries the
  // active battle's opaque token, and the server samples a different voice if
  // the model happens to be battling. The client never learns the matchup.
  const battleToken = currentBattle.voteToken;

  // The full standings in the active sort order (no text/provider filtering).
  const sortedRows = useMemo(
    () => sortTableRows(sortedModels, tableSort),
    [sortedModels, tableSort],
  );

  // The table always lists the full standings (top 10, expandable). Focus only
  // highlights the chosen row and dims the rest — it does not filter the table.
  // The Human baseline is pinned on top and always visible; "top 10" counts
  // the ranked competitors below it.
  const visibleRows = useMemo(() => {
    if (showAll) return sortedRows;
    const baselineRows = sortedRows.filter((model) => model.baseline);
    const rankedRows = sortedRows.filter((model) => !model.baseline);
    return [...baselineRows, ...rankedRows.slice(0, 10)];
  }, [showAll, sortedRows]);
  const focusedModel = focusedModelId
    ? (models.find((model) => model.id === focusedModelId) ?? null)
    : null;

  const handlePlayRound = () => {
    setReveal(null);
    arena.markRoundStarted();
    audio.playRound(currentBattle, BLIND_LEFT, BLIND_RIGHT);
    trackRoundStarted();
  };

  const handleToggleSide = (side: BattleSide) => {
    // From idle this opens the round in manual mode, so the pair must be
    // pinned and the start tracked just like the auto-sequence path.
    if (audio.roundPhase === 'idle') {
      setReveal(null);
      arena.markRoundStarted();
      trackRoundStarted();
    }
    audio.toggleBattleSide(
      side,
      side === 'left' ? BLIND_LEFT : BLIND_RIGHT,
      side === 'left' ? currentBattle.leftAudio : currentBattle.rightAudio,
    );
  };

  const handleVote = (winner: VoteChoice) => {
    if (!audio.bothStarted || revealed) return;

    // Every 10th vote must pass the Turnstile check before it counts
    // (no-op without keys — castVote then runs immediately). The reveal is
    // built entirely from the vote response (identities, deltas, correctness);
    // the client never held the pre-vote identities.
    voteGate.guardVote((captchaToken) => {
      void arena
        .applyVote({
          winner,
          voteToken: currentBattle.voteToken,
          captchaToken,
          // Offline fallback only (no token): the bundled round's local ids.
          offline: currentBattle.voteToken
            ? undefined
            : {
                leftModelId: currentBattle.leftModelId,
                rightModelId: currentBattle.rightModelId,
              },
        })
        .then((outcome) => {
          if (!outcome) return;
          setReveal(outcome);
          trackVote({
            winner,
            leftModelId: outcome.left.model.id,
            rightModelId: outcome.right.model.id,
            correct: outcome.correct,
          });
        });
    });
  };

  const handleNextComparison = () => {
    audio.resetRound();
    arena.advanceBattle();
    setReveal(null);
    lastSideRef.current = null;
  };

  // --- Keyboard fast mode -------------------------------------------------
  // ← / → play (or switch to) a side, Space votes the side being listened to,
  // and Space on the reveal jumps straight into the next round.

  /** The side the listener is judging: the one playing, else the last played. */
  const lastSideRef = useRef<BattleSide | null>(null);
  useEffect(() => {
    if (revealed || audio.roundPhase === 'idle') return;
    if (audio.playingId === BLIND_LEFT.id) lastSideRef.current = 'left';
    else if (audio.playingId === BLIND_RIGHT.id) lastSideRef.current = 'right';
  }, [audio.playingId, audio.roundPhase, revealed]);

  // Space on the reveal advances AND auto-starts once the next pair lands.
  const autoStartRef = useRef(false);
  const playRoundRef = useRef<() => void>(() => {});
  useEffect(() => {
    playRoundRef.current = handlePlayRound;
  });
  useEffect(() => {
    if (!autoStartRef.current) return;
    autoStartRef.current = false;
    playRoundRef.current();
  }, [currentBattle]);

  // Rapid-fire: once a vote lands the reveal, hold it for REVEAL_HOLD_MS, then
  // advance to the next pair AND auto-play it (autoStartRef drives the auto-play
  // when the new battle arrives, exactly like the keyboard "Space on reveal"
  // path). The vote is the user gesture browser autoplay policies require. A
  // manual/keyboard advance flips `revealed` off first, so the effect cleanup
  // cancels this timer before it can double-fire. Reduced-motion is unaffected:
  // this advances/plays, it adds no motion.
  const nextComparisonRef = useRef<() => void>(() => {});
  useEffect(() => {
    nextComparisonRef.current = handleNextComparison;
  });
  useEffect(() => {
    if (!revealed) return undefined;
    const timer = window.setTimeout(() => {
      autoStartRef.current = true;
      nextComparisonRef.current();
    }, REVEAL_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (voteGate.challengeOpen) return;
      // Stand down inside form fields and on focused controls, where these
      // keys already mean something.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, select, textarea, button, a, [contenteditable]')) {
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // Pre-vote: play/switch a side. Post-vote: replay that side's clip
        // (handleToggleSide leaves the reveal up since the round isn't idle).
        event.preventDefault();
        handleToggleSide(event.key === 'ArrowLeft' ? 'left' : 'right');
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        if (revealed) {
          autoStartRef.current = true;
          handleNextComparison();
          return;
        }
        if (audio.roundPhase === 'idle') {
          handlePlayRound();
          return;
        }
        const side =
          audio.playingId === BLIND_LEFT.id
            ? 'left'
            : audio.playingId === BLIND_RIGHT.id
              ? 'right'
              : lastSideRef.current;
        if (side) handleVote(side);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Deselecting (click-away, Escape, same dot/row again, filters changing)
  // also stops the selected model's sample — playback is tied to selection.
  // Battle-round audio is never touched (stopSamplePlayback is sample-scoped).
  const clearRankFocus = useCallback(() => {
    if (!focusedModelId) return;
    setFocusedModelId(null);
    audio.stopSamplePlayback();
  }, [focusedModelId, audio.stopSamplePlayback]);

  // Same column toggles direction; a new column starts at its natural one.
  const updateTableSort = (key: TableSortKey) => {
    setTableSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: DEFAULT_SORT_DIR[key] },
    );
  };

  const focusRankModel = (model: ScoredModel) => {
    setFocusedModelId(model.id);
    // Reveal the focused row if it lives outside the default top-10 view.
    const rank = sortedModels.findIndex((m) => m.id === model.id) + 1;
    setShowAll(rank > 10);
  };

  // Shared dot/row selection. Selecting auto-plays the sample only when
  // nothing else is on: a click must never cut off audio mid-listen. While
  // something is playing, the first click just selects and a second click
  // deliberately takes over playback; clicking the playing selection stops it.
  const selectRankModel = (model: ScoredModel) => {
    if (focusedModelId === model.id) {
      if (audio.playingId === model.id) clearRankFocus();
      else audio.playModelSample(model, battleToken);
      return;
    }
    // Play the new selection when nothing is playing, or when the current
    // sound is the previous selection (so dot→dot and row→row switch over).
    // A leaderboard card's Listen sets no selection, so it's never hijacked.
    const switchingSelection =
      audio.playingId !== null && audio.playingId === focusedModelId;
    focusRankModel(model);
    if (audio.playingId === null || switchingSelection) {
      audio.playModelSample(model, battleToken);
    }
  };

  // Listen button: toggles playback without dropping the row selection on
  // stop; starting playback selects the row so it follows the shared rules.
  const toggleRankSample = (model: ScoredModel) => {
    if (audio.playingId === model.id) {
      audio.stopPlayback();
      return;
    }
    focusRankModel(model);
    audio.playModelSample(model, battleToken);
  };

  // Leaderboard card Listen: same server-side battle-aware sample protection.
  const togglePlaySample = (model: ScoredModel) => {
    if (audio.playingId === model.id) {
      audio.stopPlayback();
      return;
    }
    audio.playModelSample(model, battleToken);
  };

  // The root layout already renders the page inside <main>, so this is a
  // div. The data-nav-theme attributes are inert markers carried over from
  // the original host site's theme-switching navbar; the standalone shell
  // ignores them.
  return (
    <div className="hi-page" data-nav-theme="light">
      <div className="app-rails" aria-hidden="true" />
      {voteGate.challenge}

      {/* Blind until the vote: the cards play from audio only, and the reveal
          (identities, deltas, result copy) is built from the vote response. */}
      <HeroSection
        reveal={reveal}
        roundPhase={audio.roundPhase}
        promptText={currentBattle.prompt}
        playedSides={audio.playedSides}
        playingSide={playingSide}
        canVote={audio.bothStarted}
        onPlayRound={handlePlayRound}
        onToggleSide={handleToggleSide}
        onVote={handleVote}
        onNext={handleNextComparison}
      />

      <HowItWorks />

      {/* Section order: the Humanness Rankings (chart + full table) come before
          the dark "what makes a voice human" band; the "Most Human Models" podium
          follows it. */}
      <RankingsSection
        sortedModels={sortedModels}
        sortedRows={sortedRows}
        visibleRows={visibleRows}
        totalUniqueVotes={arena.totalUniqueVotes}
        showAll={showAll}
        focusedModel={focusedModel}
        focusedModelId={focusedModelId}
        playingId={audio.playingId}
        sort={tableSort}
        onSortChange={updateTableSort}
        onToggleShowAll={() => setShowAll((value) => !value)}
        onSelectModel={selectRankModel}
        onClearFocus={clearRankFocus}
        onTogglePlay={toggleRankSample}
      />

      <PiecesSection />

      <LeaderboardSection
        topModels={topModels}
        allModels={sortedModels}
        playingId={audio.playingId}
        onTogglePlay={togglePlaySample}
      />

      <WhyThisExists />

      <CtaBand />
    </div>
  );
};
