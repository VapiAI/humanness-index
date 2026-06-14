/**
 * Arena API client for /api/{models,battle,vote,sample}. The server
 * implementation lives in ../server; it imports these wire types so the two
 * sides can't drift.
 */
import type { VoteChoice } from './types';

export type ArenaModelRow = {
  /** Frontend model slug, e.g. `xai-xai-tts`. */
  id: string;
  provider: string;
  model: string;
  /** Raw arena Elo (the UI applies the Humanness rubric transform on top). */
  elo: number;
  uncertainty: number;
  /** e.g. `#3-10` — the table/search's "likely rank". */
  rankRange: string;
  wins: number;
  losses: number;
  ties: number;
  voteCount: number;
};

export type ModelsResponse = {
  models: ArenaModelRow[];
  totalUniqueVotes: number;
};

/**
 * Blind by design: no model identities. The matchup is encoded only in the
 * signed `voteToken`; the client learns who was who from the vote response.
 */
export type BattleResponse = {
  id: string;
  prompt: string;
  voteToken: string;
  leftAudioUrl: string;
  rightAudioUrl: string;
};

export type RevealSide = {
  modelId: string;
  /** Post-vote model-level Elo. */
  elo: number;
  /** Signed per-side Elo shift this vote produced (the "+N Elo"). */
  eloDelta: number;
};

export type VoteResponse = {
  reveal: { left: RevealSide; right: RevealSide };
  /** Whether the pick agreed with the crowd (judged on pre-vote standings). */
  correct: boolean;
  models: ArenaModelRow[];
  totalUniqueVotes: number;
};

export type SampleResponse = {
  audioUrl: string;
  prompt: string;
};

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return response.json() as Promise<T>;
};

/** Current standings (rankings, chart, and table all render from this). */
export const getModels = (): Promise<ModelsResponse> =>
  getJson('/api/models');

/** A fresh blind head-to-head pairing for the hero picker. */
export const getBattle = (): Promise<BattleResponse> =>
  getJson('/api/battle');

/**
 * A random hosted clip for a model's "Listen" button. Pass the active battle's
 * opaque `battleToken` so the server can exclude the battle's voice/prompt if
 * the model happens to be battling — without the client ever learning the
 * matchup. Non-battling models (or no token) sample normally.
 */
export const getSample = (
  modelId: string,
  options?: { battleToken?: string | null },
): Promise<SampleResponse> => {
  const params = new URLSearchParams({ model: modelId });
  if (options?.battleToken) params.set('battleToken', options.battleToken);
  return getJson(`/api/sample?${params.toString()}`);
};

/**
 * Record a vote; returns the reveal plus refreshed standings.
 * `captchaToken` is the solved Turnstile token attached to every 10th vote
 * (see ../hooks/useVoteGate); the server verifies it when configured.
 */
export const submitVote = async (
  voteToken: string,
  winner: VoteChoice,
  captchaToken?: string,
): Promise<VoteResponse> => {
  const response = await fetch('/api/vote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      voteToken,
      winner,
      ...(captchaToken ? { captchaToken } : {}),
    }),
  });
  if (!response.ok) throw new Error(`vote failed: ${response.status}`);
  return response.json() as Promise<VoteResponse>;
};
