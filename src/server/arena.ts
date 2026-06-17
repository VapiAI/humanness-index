/**
 * Arena service — the operations behind /api/*. Composes the
 * catalog, Elo engine, signed battle tokens, and the store.
 */
import { randomUUID } from 'node:crypto';

import type {
  ArenaModelRow,
  BattleResponse,
  ModelsResponse,
  SampleResponse,
  VoteResponse,
} from '../lib/api';
import { voteMatchesCrowd } from '../lib/scoring';
import {
  audioUrlFor,
  MODELS,
  MODELS_BY_ID,
  PROMPTS,
  PROVIDERS_BY_ID,
  VARIANTS_BY_ID,
  variantsOfModel,
} from './catalog';
import {
  applyVoteToStats,
  chooseBattlePair,
  freshVariantStats,
  INITIAL_ELO,
  leaderboard,
  type StandingsState,
  type VoteWinner,
} from './elo';
import {
  bootstrapRankRange,
  bradleyTerryFit,
  BT_CENTER,
  formatRankRange,
  type AnchorRecord,
  type Outcome,
} from './bradleyTerry';
import { battleTokenDecode, battleTokenEncode } from './battleToken';
import seedStandings from './seed-standings.json';
import { arenaStore, DuplicateVoteError, type VoteEvent } from './store';

/** The Human baseline's model id — the fixed reference the field is scored against. */
const BASELINE_ID = 'human';

/**
 * Seed export folded in as anchor games (no loss): the original prototype only
 * carries per-model win/loss/tie totals, so they count as games versus a
 * center-strength reference. Live pairwise votes dominate.
 */
const SEED_ANCHORS = new Map<string, AnchorRecord>(
  seedStandings.models
    .filter((model) => MODELS_BY_ID.has(model.id))
    .map((model) => [
      model.id,
      { wins: model.wins, losses: model.losses, ties: model.ties },
    ]),
);

const round2 = (value: number) => Math.round(value * 100) / 100;
const eloStandardError = (voteCount: number) =>
  Math.round(160 / Math.sqrt(Math.max(1, voteCount)));

/**
 * The published standings: a Bradley–Terry maximum-likelihood fit over the full
 * vote log (settles, accounts for opponent strength) with bootstrap rank
 * ranges. The Elo `state` is still folded for pairing + crowd-correctness, but
 * the leaderboard the world sees is this BT fit.
 */
const bradleyTerryLeaderboard = (
  state: StandingsState,
  events: VoteEvent[],
): ArenaModelRow[] => {
  const players = MODELS.map((model) => model.id);
  const outcomes: Outcome[] = [];
  for (const event of events) {
    const left = VARIANTS_BY_ID.get(event.leftVariantId)?.modelId;
    const right = VARIANTS_BY_ID.get(event.rightVariantId)?.modelId;
    if (!left || !right || left === right) continue;
    outcomes.push({ left, right, winner: event.winner });
  }
  const input = { players, outcomes, anchors: SEED_ANCHORS, prior: 1 };
  const { ratings } = bradleyTerryFit(input);
  // Likely rank is over the competitors (the Human baseline is the reference,
  // not a ranked entrant) so it matches the #N shown elsewhere.
  const competitors = players.filter((id) => id !== BASELINE_ID);
  const ranges = bootstrapRankRange(input, competitors, {
    resamples: 200,
    interval: 0.95,
  });

  const countsFor = (modelId: string) => {
    const stats = variantsOfModel(modelId).map(
      (variant) => state.get(variant.id) ?? freshVariantStats(),
    );
    return {
      wins: stats.reduce((sum, s) => sum + s.wins, 0),
      losses: stats.reduce((sum, s) => sum + s.losses, 0),
      ties: stats.reduce((sum, s) => sum + s.ties, 0),
      voteCount: stats.reduce((sum, s) => sum + s.voteCount, 0),
    };
  };

  return players
    .map((id): ArenaModelRow => {
      const model = MODELS_BY_ID.get(id)!;
      const counts = countsFor(id);
      return {
        id,
        provider: PROVIDERS_BY_ID.get(model.providerId)!.name,
        model: model.name,
        elo: round2(ratings.get(id) ?? BT_CENTER),
        uncertainty: eloStandardError(counts.voteCount),
        // The baseline shows "Baseline"/dash in the UI, so its range is cosmetic.
        rankRange: id === BASELINE_ID ? '#1' : formatRankRange(ranges.get(id)!),
        ...counts,
      };
    })
    .sort(
      (a, b) =>
        b.elo - a.elo ||
        b.voteCount - a.voteCount ||
        a.provider.localeCompare(b.provider) ||
        a.model.localeCompare(b.model),
    );
};

export const getModels = async (): Promise<ModelsResponse> => {
  const store = arenaStore();
  const [{ state, totalVotes }, events] = await Promise.all([
    store.load(),
    store.loadVoteEvents(),
  ]);
  return {
    models: bradleyTerryLeaderboard(state, events),
    totalUniqueVotes: totalVotes,
  };
};

export const createBattle = async (): Promise<BattleResponse> => {
  const { state } = await arenaStore().load();
  // The pair is two variants on a shared source voice that BOTH models serve
  // (chooseBattlePair groups by voice over the availability-restricted
  // VARIANTS matrix), so the clip URLs below always resolve — a model is never
  // asked for a voice it has no clips for.
  const [left, right] = chooseBattlePair(state);
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  const payload = {
    id: `battle:${randomUUID().replaceAll('-', '')}`,
    promptId: prompt.id,
    leftVariantId: left.id,
    rightVariantId: right.id,
    createdAt: Date.now(),
  };
  // Blind by design: the response carries NO model identities. The matchup
  // lives only inside the signed voteToken (server-decodable), so the frontend
  // cannot reveal which model is which until the vote response comes back.
  return {
    id: payload.id,
    prompt: prompt.text,
    voteToken: battleTokenEncode(payload),
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

  // "Correct" = the pick agreed with the crowd, judged on the PRE-vote
  // model-level standings (computed here so the client never needs pre-vote
  // identities to build the reveal).
  const preModels = leaderboard(state);
  const preElo = (modelId: string) =>
    preModels.find((row) => row.id === modelId)?.elo ?? INITIAL_ELO;
  const correct = voteMatchesCrowd(
    preElo(left.modelId),
    preElo(right.modelId),
    winner,
  );

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

  // Everything the client needs to render the reveal without ever having held
  // the pre-vote identities: each side's model id, post-vote model elo, and the
  // signed per-side Elo shift this vote produced (variant-level, the "+N Elo").
  return {
    reveal: {
      left: {
        modelId: left.modelId,
        elo: eloOf(left.modelId),
        eloDelta: Math.round(updated.left.elo - leftBefore.elo),
      },
      right: {
        modelId: right.modelId,
        elo: eloOf(right.modelId),
        eloDelta: Math.round(updated.right.elo - rightBefore.elo),
      },
    },
    correct,
    models,
    totalUniqueVotes: totalVotes + 1,
  };
};

/**
 * A random hosted clip for a model's "Listen" button.
 *
 * Blind-test integrity (server-side, so the client never learns the matchup):
 * pass the active battle's opaque `battleToken`. The server decodes it, and if
 * the requested model is one of the battle's two models, it samples a DIFFERENT
 * source voice than the battle (and a different prompt). A different voice is a
 * different variant, hence different audio, so no labeled leaderboard/table/
 * chart sample can match (or unmask) a blind battle card. Models not in the
 * battle — or any request without a valid token — sample normally. Falls back
 * to any variant/prompt only if the model serves no other voice (TTS have 4,
 * Human has 2).
 */
export const getSample = async (
  modelId: string,
  options: { battleToken?: string } = {},
): Promise<SampleResponse> => {
  const variants = [...VARIANTS_BY_ID.values()].filter(
    (variant) => variant.modelId === modelId,
  );
  if (variants.length === 0) throw new VoteError(`Unknown model: ${modelId}`);

  let excludeVoiceId: string | undefined;
  let excludePromptId: string | undefined;
  if (options.battleToken) {
    try {
      const payload = battleTokenDecode(options.battleToken);
      const battleLeft = VARIANTS_BY_ID.get(payload.leftVariantId);
      const battleRight = VARIANTS_BY_ID.get(payload.rightVariantId);
      if (battleLeft?.modelId === modelId || battleRight?.modelId === modelId) {
        // Both battle variants share one source voice; exclude it + the prompt.
        excludeVoiceId = battleLeft?.sourceVoiceId;
        excludePromptId = payload.promptId;
      }
    } catch {
      // Bad/tampered/expired token: no exclusion, sample normally.
    }
  }

  const offVoice = excludeVoiceId
    ? variants.filter((variant) => variant.sourceVoiceId !== excludeVoiceId)
    : variants;
  const variantPool = offVoice.length > 0 ? offVoice : variants;
  const variant = variantPool[Math.floor(Math.random() * variantPool.length)];

  const offPrompt = excludePromptId
    ? PROMPTS.filter((prompt) => prompt.id !== excludePromptId)
    : PROMPTS;
  const promptPool = offPrompt.length > 0 ? offPrompt : PROMPTS;
  const prompt = promptPool[Math.floor(Math.random() * promptPool.length)];

  return {
    audioUrl: audioUrlFor(variant.id, prompt.id),
    prompt: prompt.text,
  };
};
