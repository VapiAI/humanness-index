'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

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
import type { ScoredModel, TableSort, TableSortKey, VoteChoice } from './lib/types';

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
  const topModels = sortedModels.slice(0, 11);

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
  };

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

  // Shared dot/row selection: selecting a model focuses it and plays its
  // sample; selecting it again deselects and stops.
  const selectRankModel = (model: ScoredModel) => {
    if (focusedModelId === model.id) {
      clearRankFocus();
      return;
    }
    focusRankModel(model);
    audio.playModelSample(model);
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
        battle={currentBattle}
        leftModel={reveal?.left ?? leftModel}
        rightModel={reveal?.right ?? rightModel}
        sortedModels={reveal?.sorted ?? sortedModels}
        roundPhase={audio.roundPhase}
        playedSides={audio.playedSides}
        playingId={audio.playingId}
        promptProgress={audio.promptProgress}
        revealed={revealed}
        roundResult={reveal?.winner ?? null}
        canVote={audio.bothStarted}
        voteCorrect={reveal?.correct ?? false}
        voteImpact={reveal ? { left: reveal.leftDelta, right: reveal.rightDelta } : null}
        onPlayRound={handlePlayRound}
        onToggleSide={(side) =>
          audio.toggleBattleSide(
            side,
            side === 'left' ? leftModel : rightModel,
            side === 'left' ? currentBattle.leftAudio : currentBattle.rightAudio,
          )
        }
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
