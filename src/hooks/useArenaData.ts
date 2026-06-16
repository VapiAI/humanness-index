'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { HERO_BATTLES } from '../data/battles';
import { ARENA_ROWS, mergeStandings, SEED_TOTAL_UNIQUE_VOTES } from '../data/models';
import { type ArenaModelRow, getBattle, getModels, submitVote } from '../lib/api';
import {
  competitorRank,
  eloExpectation,
  humannessScore,
  outcomeFor,
  sortByStanding,
  voteMatchesCrowd,
} from '../lib/scoring';
import type {
  ArenaRow,
  HeroBattle,
  RoundReveal,
  ScoredModel,
  VoteChoice,
} from '../lib/types';

/** Elo K-factor for the optimistic local update (matches the backend). */
const VOTE_K = 32;

/**
 * Server-rendered first-paint standings (the hourly `getStandingsSnapshot`),
 * handed to the hook so the table/chart hydrate from the SAME data the live
 * `/api/models` fetch returns. Without it the hook falls back to the bundled
 * static export, which can list a different model set/order and visibly
 * reshuffle the moment the live fetch lands.
 */
export type ArenaStandingsSeed = {
  models: ArenaModelRow[];
  totalUniqueVotes: number;
};

/**
 * The arena's data layer, backed by /api/*:
 *
 * - Standings render instantly from the server snapshot (or the static export
 *   when none is supplied), then refresh from the live leaderboard on mount.
 *   Seeding from the snapshot makes that refresh a no-op in the common case, so
 *   the rankings don't reshuffle under the reveal animation.
 * - Battles come from the server (signed vote token + hosted clip URLs); the
 *   next pairing is prefetched while the reveal is on screen, and the
 *   hardcoded pairs remain as offline fallbacks.
 * - Votes apply optimistically (local pairwise Elo) and POST to the backend,
 *   whose response — the post-vote leaderboard — reconciles local state.
 */
export const useArenaData = (seed?: ArenaStandingsSeed) => {
  const [models, setModels] = useState<ScoredModel[]>(() =>
    seed ? mergeStandings(seed.models) : ARENA_ROWS,
  );
  const [totalUniqueVotes, setTotalUniqueVotes] = useState(
    () => seed?.totalUniqueVotes ?? SEED_TOTAL_UNIQUE_VOTES,
  );
  const [battle, setBattle] = useState<HeroBattle>(HERO_BATTLES[0]);
  // False until the on-mount live fetch has reconciled (or a safety timeout
  // elapses). The standings reveals gate their entrance on this so the table,
  // chart, and cards animate to the LIVE numbers rather than the cached
  // snapshot and then jumping when the fetch lands.
  const [standingsReady, setStandingsReady] = useState(false);

  // Once the listener has voted, optimistic/server-reconciled standings win
  // over the late-resolving mount refresh.
  const hasVotedRef = useRef(false);
  // While a round is playing the on-screen pair must not change under it.
  const roundActiveRef = useRef(false);
  const upcomingBattleRef = useRef<HeroBattle | null>(null);
  const fallbackIndexRef = useRef(0);

  const fetchBattle = useCallback(async (): Promise<HeroBattle> => {
    try {
      const fetched = await getBattle();
      // Live battles are blind: no model ids enter client state.
      return {
        prompt: fetched.prompt,
        leftAudio: fetched.leftAudioUrl,
        rightAudio: fetched.rightAudioUrl,
        voteToken: fetched.voteToken,
      };
    } catch {
      // Offline/dev fallback: rotate the curated pairs (votes stay local).
      fallbackIndexRef.current += 1;
      return HERO_BATTLES[fallbackIndexRef.current % HERO_BATTLES.length];
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getModels()
      .then(({ models: rows, totalUniqueVotes: votes }) => {
        if (!active || hasVotedRef.current) return;
        setModels(mergeStandings(rows));
        setTotalUniqueVotes(votes);
      })
      .catch(() => {
        // Static snapshot stays.
      })
      .finally(() => {
        // Arm the standings reveals once we've reconciled (or failed) — the
        // animation now reflects live data.
        if (active) setStandingsReady(true);
      });
    // Safety net: never hold the reveal indefinitely if the network is slow or
    // wedged; fall back to revealing the snapshot after a short beat.
    const readyFallback = window.setTimeout(() => {
      if (active) setStandingsReady(true);
    }, 2500);
    void fetchBattle().then((fetched) => {
      if (!active) return;
      if (roundActiveRef.current) upcomingBattleRef.current = fetched;
      else setBattle(fetched);
    });
    return () => {
      active = false;
      window.clearTimeout(readyFallback);
    };
  }, [fetchBattle]);

  const sortedModels = useMemo(() => sortByStanding(models), [models]);

  /** Pin the on-screen pair for the duration of a round. */
  const markRoundStarted = useCallback(() => {
    roundActiveRef.current = true;
  }, []);

  /** Swap in the (usually prefetched) next pairing and top the queue back up. */
  const advanceBattle = useCallback(() => {
    roundActiveRef.current = false;
    const upcoming = upcomingBattleRef.current;
    upcomingBattleRef.current = null;
    if (upcoming) setBattle(upcoming);
    void fetchBattle().then((fetched) => {
      if (upcoming) {
        upcomingBattleRef.current = fetched;
      } else if (roundActiveRef.current) {
        upcomingBattleRef.current = fetched;
      } else {
        setBattle(fetched);
      }
    });
  }, [fetchBattle]);

  /**
   * Record a head-to-head outcome and return the fully-built reveal.
   *
   * LIVE path (signed voteToken): POST to the backend and trust its response —
   * the authoritative post-vote leaderboard plus the reveal (identities,
   * per-side Elo shift, crowd-correctness). No optimistic update and no
   * pre-vote identities are needed. OFFLINE path (no token, bundled fallback
   * round): resolve the round's local ids and compute a reveal + optimistic
   * standings client-side. Returns null if the vote could not be recorded.
   */
  const applyVote = useCallback(
    async ({
      winner,
      voteToken,
      captchaToken,
      offline,
    }: {
      winner: VoteChoice;
      voteToken: string | null;
      /** Solved Turnstile token on gated (every 10th) votes. */
      captchaToken?: string;
      /** Local ids for the offline fallback round (live path omits this). */
      offline?: { leftModelId?: string; rightModelId?: string };
    }): Promise<RoundReveal | null> => {
      hasVotedRef.current = true;

      let nextModels: ArenaRow[];
      let sides: {
        left: { modelId: string; eloDelta: number };
        right: { modelId: string; eloDelta: number };
      };
      let correct: boolean;

      if (voteToken) {
        let response;
        try {
          response = await submitVote(voteToken, winner, captchaToken);
        } catch {
          return null; // network failure: caller leaves the round as-is
        }
        nextModels = mergeStandings(response.models);
        setModels(nextModels);
        setTotalUniqueVotes(response.totalUniqueVotes);
        sides = {
          left: {
            modelId: response.reveal.left.modelId,
            eloDelta: response.reveal.left.eloDelta,
          },
          right: {
            modelId: response.reveal.right.modelId,
            eloDelta: response.reveal.right.eloDelta,
          },
        };
        correct = response.correct;
      } else {
        const left = models.find((m) => m.id === offline?.leftModelId);
        const right = models.find((m) => m.id === offline?.rightModelId);
        if (!left || !right) return null;
        const expectedLeft = eloExpectation(left.elo, right.elo);
        const leftOutcome = outcomeFor(winner, 'left');
        const rightOutcome = outcomeFor(winner, 'right');
        const leftDelta = Math.round(VOTE_K * (leftOutcome - expectedLeft));
        const rightDelta = Math.round(VOTE_K * (rightOutcome - (1 - expectedLeft)));
        correct = voteMatchesCrowd(left.elo, right.elo, winner);
        nextModels = models.map((model) => {
          if (model.id !== left.id && model.id !== right.id) return model;
          const isLeft = model.id === left.id;
          const delta = isLeft ? leftDelta : rightDelta;
          const outcome = isLeft ? leftOutcome : rightOutcome;
          return {
            ...model,
            elo: model.elo + delta,
            wins: model.wins + (outcome === 1 ? 1 : 0),
            losses: model.losses + (outcome === 0 ? 1 : 0),
            ties: model.ties + (outcome === 0.5 ? 1 : 0),
          };
        });
        setModels(nextModels);
        setTotalUniqueVotes((count) => count + 1);
        sides = {
          left: { modelId: left.id, eloDelta: leftDelta },
          right: { modelId: right.id, eloDelta: rightDelta },
        };
      }

      // Prefetch the next pairing while the reveal is on screen.
      void fetchBattle().then((fetched) => {
        upcomingBattleRef.current = fetched;
      });

      // Build the reveal from the post-vote standings (a consistent snapshot).
      const sorted = sortByStanding(nextModels);
      const cardFor = (side: { modelId: string; eloDelta: number }) => {
        const model = nextModels.find((m) => m.id === side.modelId);
        if (!model) return null;
        return {
          model,
          rank: competitorRank(model.id, sorted),
          humanness: humannessScore(model, sorted),
          eloDelta: side.eloDelta,
        };
      };
      const left = cardFor(sides.left);
      const right = cardFor(sides.right);
      if (!left || !right) return null;
      return { winner, correct, left, right };
    },
    [fetchBattle, models],
  );

  return {
    models,
    sortedModels,
    battle,
    totalUniqueVotes,
    standingsReady,
    markRoundStarted,
    advanceBattle,
    applyVote,
  };
};
