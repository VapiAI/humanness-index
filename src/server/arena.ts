/**
 * Arena service — the operations behind /api/*. Composes the
 * catalog, Elo engine, signed battle tokens, and the store.
 */
import { randomUUID } from 'node:crypto';

import type {
  BattleResponse,
  ModelsResponse,
  SampleResponse,
  VoteResponse,
} from '../lib/api';
import { audioUrlFor, PROMPTS, VARIANTS_BY_ID } from './catalog';
import {
  applyVoteToStats,
  chooseBattlePair,
  freshVariantStats,
  leaderboard,
  type VoteWinner,
} from './elo';
import { battleTokenDecode, battleTokenEncode } from './battleToken';
import { arenaStore, DuplicateVoteError } from './store';

export const getModels = async (): Promise<ModelsResponse> => {
  const { state, totalVotes } = await arenaStore().load();
  return { models: leaderboard(state), totalUniqueVotes: totalVotes };
};

export const createBattle = async (): Promise<BattleResponse> => {
  const { state } = await arenaStore().load();
  const [left, right] = chooseBattlePair(state);
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  const payload = {
    id: `battle:${randomUUID().replaceAll('-', '')}`,
    promptId: prompt.id,
    leftVariantId: left.id,
    rightVariantId: right.id,
    createdAt: Date.now(),
  };
  return {
    id: payload.id,
    prompt: prompt.text,
    voteToken: battleTokenEncode(payload),
    leftModelId: left.modelId,
    rightModelId: right.modelId,
    leftAudioUrl: audioUrlFor(left.id, prompt.id),
    rightAudioUrl: audioUrlFor(right.id, prompt.id),
  };
};

export class VoteError extends Error {}

const isVoteWinner = (value: string): value is VoteWinner =>
  value === 'left' || value === 'right' || value === 'tie';

export const submitVote = async (
  voteToken: string,
  winner: string,
): Promise<VoteResponse> => {
  if (!isVoteWinner(winner)) {
    throw new VoteError('Winner must be left, right, or tie');
  }
  let payload;
  try {
    payload = battleTokenDecode(voteToken);
  } catch {
    throw new VoteError('Invalid battle token');
  }
  const left = VARIANTS_BY_ID.get(payload.leftVariantId);
  const right = VARIANTS_BY_ID.get(payload.rightVariantId);
  if (!left || !right) throw new VoteError('Unknown battle variants');

  const store = arenaStore();
  const { state, totalVotes } = await store.load();
  const leftBefore = state.get(left.id) ?? freshVariantStats();
  const rightBefore = state.get(right.id) ?? freshVariantStats();
  const updated = applyVoteToStats(leftBefore, rightBefore, winner);

  try {
    await store.recordVote({
      id: `elo:${randomUUID().replaceAll('-', '')}`,
      battleId: payload.id,
      winner,
      leftVariantId: left.id,
      rightVariantId: right.id,
      leftEloBefore: leftBefore.elo,
      rightEloBefore: rightBefore.elo,
      leftEloAfter: updated.left.elo,
      rightEloAfter: updated.right.elo,
      createdAt: Date.now(),
    });
  } catch (error) {
    if (error instanceof DuplicateVoteError) {
      throw new VoteError(error.message);
    }
    throw error;
  }

  state.set(left.id, updated.left);
  state.set(right.id, updated.right);
  const models = leaderboard(state);
  const eloOf = (modelId: string) =>
    models.find((row) => row.id === modelId)?.elo ?? 0;

  return {
    reveal: {
      left: { modelId: left.modelId, elo: eloOf(left.modelId) },
      right: { modelId: right.modelId, elo: eloOf(right.modelId) },
    },
    models,
    totalUniqueVotes: totalVotes + 1,
  };
};

export const getSample = async (modelId: string): Promise<SampleResponse> => {
  const variants = [...VARIANTS_BY_ID.values()].filter(
    (variant) => variant.modelId === modelId,
  );
  if (variants.length === 0) throw new VoteError(`Unknown model: ${modelId}`);
  const variant = variants[Math.floor(Math.random() * variants.length)];
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  return {
    audioUrl: audioUrlFor(variant.id, prompt.id),
    prompt: prompt.text,
  };
};
