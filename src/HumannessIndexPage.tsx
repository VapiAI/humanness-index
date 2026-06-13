'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import './styles/tokens.css';
import './styles/humanness-index.css';

import { CtaBand } from './components/CtaBand';
import { HeroSection } from './components/HeroSection';
import { LeaderboardSection } from './components/LeaderboardSection';
import { PiecesSection } from './components/PiecesSection';
import { RankingsSection } from './components/RankingsSection';
import { useArenaAudio } from './hooks/useArenaAudio';
import { useArenaData } from './hooks/useArenaData';
import { useVoteGate } from './hooks/useVoteGate';
import { voiceStats } from './data/providers';
import { trackRoundStarted, trackVote } from './lib/analytics';
import { parseLatencyMs, voteMatchesCrowd } from './lib/scoring';
import type {
  BattleSide,
  ScoredModel,
  TableSort,
  TableSortKey,
  VoteChoice,
} from './lib/types';

const ALL_PROVIDERS = 'All providers';

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
      // Rank and Humanness sort on the same backing value: Elo.
      case 'rank':
      case 'humanness':
        return model.elo;
    }
  };
  const flip = sort.dir === 'asc' ? 1 : -1;
  // Rank #1 is the highest Elo, so ascending rank descends by value.
  const dir = sort.key === 'rank' ? -flip : flip;
  return [...rows].sort((a, b) => {
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
 * The post-vote reveal, snapshotted at vote time. The vote itself shifts the
 * standings, so correctness AND the "crowd favorite" copy must both be judged
 * against the pre-vote order — otherwise a vote that flips two close models
 * would name the listener's own pick as the crowd's.
 */
type RoundReveal = {
  winner: VoteChoice;
  correct: boolean;
  left: ScoredModel;
  right: ScoredModel;
  sorted: ScoredModel[];
  /** Pairwise Elo shifts this vote produced (left/right, signed). */
  leftDelta: number;
  rightDelta: number;
};

export const HumannessIndexPage = () => {
  const arena = useArenaData();
  const audio = useArenaAudio();
  const voteGate = useVoteGate();

  const [reveal, setReveal] = useState<RoundReveal | null>(null);
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState(ALL_PROVIDERS);
  const [showAll, setShowAll] = useState(false);
  const [focusedModelId, setFocusedModelId] = useState<string | null>(null);
  const [tableSort, setTableSort] = useState<TableSort>({ key: 'rank', dir: 'asc' });

  const revealed = reveal !== null;

  // Stop any clip that's still playing the moment the vote flips to the reveal view.
  useEffect(() => {
    if (revealed) audio.stopPlayback();
  }, [revealed, audio.stopPlayback]);

  const { models, sortedModels, battle: currentBattle } = arena;

  const providerOptions = useMemo(
    () => [ALL_PROVIDERS, ...new Set(models.map((row) => row.provider))],
    [models],
  );
  // Two grid rows: the double-width #1 card plus six rank cards.
  const topModels = sortedModels.slice(0, 7);

  const leftModel =
    models.find((model) => model.id === currentBattle.leftModelId) ?? sortedModels[0];
  const rightModel =
    models.find((model) => model.id === currentBattle.rightModelId) ?? sortedModels[1];

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = sortedModels.filter((model) => {
      const matchesProvider = provider === ALL_PROVIDERS || model.provider === provider;
      const matchesQuery =
        !query ||
        [model.provider, model.model, model.likelyRank]
          .join(' ')
          .toLowerCase()
          .includes(query);
      return matchesProvider && matchesQuery;
    });
    return sortTableRows(matches, tableSort);
  }, [provider, search, sortedModels, tableSort]);

  // The table always lists the full standings (top 10, expandable). Focus only
  // highlights the chosen row and dims the rest — it does not filter the table.
  const visibleRows = showAll ? filteredRows : filteredRows.slice(0, 10);
  const focusedModel = focusedModelId
    ? (models.find((model) => model.id === focusedModelId) ?? null)
    : null;

  const handlePlayRound = () => {
    setReveal(null);
    arena.markRoundStarted();
    audio.playRound(currentBattle, leftModel, rightModel);
    trackRoundStarted({
      leftModelId: leftModel.id,
      rightModelId: rightModel.id,
    });
  };

  const handleToggleSide = (side: BattleSide) => {
    // From idle this opens the round in manual mode, so the pair must be
    // pinned and the start tracked just like the auto-sequence path.
    if (audio.roundPhase === 'idle') {
      setReveal(null);
      arena.markRoundStarted();
      trackRoundStarted({
        leftModelId: leftModel.id,
        rightModelId: rightModel.id,
      });
    }
    audio.toggleBattleSide(
      side,
      side === 'left' ? leftModel : rightModel,
      side === 'left' ? currentBattle.leftAudio : currentBattle.rightAudio,
    );
  };

  const handleVote = (winner: VoteChoice) => {
    if (!audio.bothStarted || revealed) return;

    // Every 10th vote must pass the Turnstile check before it counts
    // (no-op without keys — castVote then runs immediately).
    voteGate.guardVote((captchaToken) => {
      // Judge the pick against pre-vote standings, then apply it.
      const correct = voteMatchesCrowd(leftModel.elo, rightModel.elo, winner);
      const { leftDelta, rightDelta } = arena.applyVote({
        leftModel,
        rightModel,
        winner,
        voteToken: currentBattle.voteToken,
        captchaToken,
      });
      trackVote({
        winner,
        leftModelId: leftModel.id,
        rightModelId: rightModel.id,
        correct,
      });
      setReveal({
        winner,
        correct,
        left: leftModel,
        right: rightModel,
        sorted: sortedModels,
        leftDelta,
        rightDelta,
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
    if (audio.playingId === leftModel.id) lastSideRef.current = 'left';
    else if (audio.playingId === rightModel.id) lastSideRef.current = 'right';
  }, [audio.playingId, audio.roundPhase, revealed, leftModel.id, rightModel.id]);

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
        if (revealed) return;
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
          audio.playingId === leftModel.id
            ? 'left'
            : audio.playingId === rightModel.id
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

  const updateRankingSearch = (value: string) => {
    setSearch(value);
    clearRankFocus();
    setShowAll(false);
  };

  const updateRankingProvider = (value: string) => {
    setProvider(value);
    clearRankFocus();
    setShowAll(false);
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
      else audio.playModelSample(model);
      return;
    }
    // Play the new selection when nothing is playing, or when the current
    // sound is the previous selection (so dot→dot and row→row switch over).
    // A leaderboard card's Listen sets no selection, so it's never hijacked.
    const switchingSelection =
      audio.playingId !== null && audio.playingId === focusedModelId;
    focusRankModel(model);
    if (audio.playingId === null || switchingSelection) {
      audio.playModelSample(model);
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
    audio.playModelSample(model);
  };

  // The root layout already renders the page inside <main>, so this is a
  // div. The data-nav-theme attributes are inert markers carried over from
  // the original host site's theme-switching navbar; the standalone shell
  // ignores them.
  return (
    <div className="hi-page" data-nav-theme="light">
      <div className="app-rails" aria-hidden="true" />
      {voteGate.challenge}

      {/* While the reveal is up, the hero reads from the pre-vote snapshot so
          the leader/rank copy describes the matchup the listener judged. */}
      <HeroSection
        leftModel={reveal?.left ?? leftModel}
        rightModel={reveal?.right ?? rightModel}
        sortedModels={reveal?.sorted ?? sortedModels}
        roundPhase={audio.roundPhase}
        playedSides={audio.playedSides}
        playingId={audio.playingId}
        revealed={revealed}
        roundResult={reveal?.winner ?? null}
        canVote={audio.bothStarted}
        voteCorrect={reveal?.correct ?? false}
        voteImpact={reveal ? { left: reveal.leftDelta, right: reveal.rightDelta } : null}
        onPlayRound={handlePlayRound}
        onToggleSide={handleToggleSide}
        onVote={handleVote}
        onNext={handleNextComparison}
      />

      <LeaderboardSection
        topModels={topModels}
        allModels={sortedModels}
        playingId={audio.playingId}
        onTogglePlay={audio.togglePlay}
      />

      <PiecesSection />

      <RankingsSection
        sortedModels={sortedModels}
        filteredRows={filteredRows}
        visibleRows={visibleRows}
        totalUniqueVotes={arena.totalUniqueVotes}
        search={search}
        provider={provider}
        providerOptions={providerOptions}
        showAll={showAll}
        focusedModel={focusedModel}
        focusedModelId={focusedModelId}
        playingId={audio.playingId}
        sort={tableSort}
        onSortChange={updateTableSort}
        onSearchChange={updateRankingSearch}
        onProviderChange={updateRankingProvider}
        onToggleShowAll={() => setShowAll((value) => !value)}
        onSelectModel={selectRankModel}
        onClearFocus={clearRankFocus}
        onTogglePlay={toggleRankSample}
      />

      <CtaBand />
    </div>
  );
};
