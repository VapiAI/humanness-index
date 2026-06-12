'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { HERO_BATTLES } from '../data/battles';
import { ARENA_ROWS, mergeStandings, SEED_TOTAL_UNIQUE_VOTES } from '../data/models';
import { getBattle, getModels, submitVote } from '../lib/api';
import { eloExpectation, outcomeFor, sortByStanding } from '../lib/scoring';
import type { HeroBattle, ScoredModel, VoteChoice } from '../lib/types';

/** Elo K-factor for the optimistic local update (matches the backend). */
const VOTE_K = 32;

/**
 * The arena's data layer, backed by /api/*:
 *
 * - Standings render instantly from the static export snapshot, then refresh
 *   from the live leaderboard on mount.
 * - Battles come from the server (signed vote token + hosted clip URLs); the
 *   next pairing is prefetched while the reveal is on screen, and the
 *   hardcoded pairs remain as offline fallbacks.
 * - Votes apply optimistically (local pairwise Elo) and POST to the backend,
 *   whose response — the post-vote leaderboard — reconciles local state.
 */
export const useArenaData = () => {
  const [models, setModels] = useState<ScoredModel[]>(ARENA_ROWS);
  const [totalUniqueVotes, setTotalUniqueVotes] = useState(
    SEED_TOTAL_UNIQUE_VOTES,
  );
  const [battle, setBattle] = useState<HeroBattle>(HERO_BATTLES[0]);

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
      return {
        prompt: fetched.prompt,
        leftModelId: fetched.leftModelId,
        rightModelId: fetched.rightModelId,
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
      });
    void fetchBattle().then((fetched) => {
      if (!active) return;
      if (roundActiveRef.current) upcomingBattleRef.current = fetched;
      else setBattle(fetched);
    });
    return () => {
      active = false;
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
   * Record a head-to-head outcome: optimistic pairwise Elo locally, POSTed to
   * the backend, whose authoritative standings reconcile on response.
   */
  const applyVote = useCallback(
    ({
      leftModel,
      rightModel,
      winner,
      voteToken,
      captchaToken,
    }: {
      leftModel: ScoredModel;
      rightModel: ScoredModel;
      winner: VoteChoice;
      voteToken: string | null;
      /** Solved Turnstile token on gated (every 10th) votes. */
      captchaToken?: string;
    }) => {
      hasVotedRef.current = true;

      const expectedLeft = eloExpectation(leftModel.elo, rightModel.elo);
      const expectedRight = 1 - expectedLeft;
      const leftOutcome = outcomeFor(winner, 'left');
      const rightOutcome = outcomeFor(winner, 'right');
      const leftDelta = Math.round(VOTE_K * (leftOutcome - expectedLeft));
      const rightDelta = Math.round(VOTE_K * (rightOutcome - expectedRight));

      setModels((currentModels) =>
        currentModels.map((model) => {
          if (model.id !== leftModel.id && model.id !== rightModel.id) {
            return model;
          }
          const isLeft = model.id === leftModel.id;
          const delta = isLeft ? leftDelta : rightDelta;
          const outcome = isLeft ? leftOutcome : rightOutcome;
          return {
            ...model,
            elo: model.elo + delta,
            wins: model.wins + (outcome === 1 ? 1 : 0),
            losses: model.losses + (outcome === 0 ? 1 : 0),
            ties: model.ties + (outcome === 0.5 ? 1 : 0),
          };
        }),
      );
      setTotalUniqueVotes((count) => count + 1);

      if (voteToken) {
        void submitVote(voteToken, winner, captchaToken)
          .then((response) => {
            setModels(mergeStandings(response.models));
            setTotalUniqueVotes(response.totalUniqueVotes);
          })
          .catch(() => {
            // Keep the optimistic update if the POST fails.
          });
      }

      // Prefetch the next pairing while the reveal is on screen.
      void fetchBattle().then((fetched) => {
        upcomingBattleRef.current = fetched;
      });
    },
    [fetchBattle],
  );

  return {
    models,
    sortedModels,
    battle,
    totalUniqueVotes,
    markRoundStarted,
    advanceBattle,
    applyVote,
  };
};
