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
  blindClipUrl,
  MODELS,
  MODELS_BY_ID,
  PROMPTS,
  PROVIDERS_BY_ID,
  VARIANTS_BY_ID,
  variantsOfModel,
} from './catalog';
import {
  chooseBattlePair,
  freshVariantStats,
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
import {
  arenaStore,
  DuplicateVoteError,
  type StoredStandings,
  type VoteEvent,
} from './store';

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
/** Rough rating uncertainty after `voteCount` votes (160/√n), for the table. */
const ratingStandardError = (voteCount: number) =>
  Math.round(160 / Math.sqrt(Math.max(1, voteCount)));

type ModelCounts = { wins: number; losses: number; ties: number; voteCount: number };

/** Sum a model's variant-level stats into a single win/loss/tie/vote tally. */
const aggregateCounts = (state: StandingsState, modelId: string): ModelCounts => {
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

/**
 * Fit the published standings: a Bradley–Terry maximum-likelihood estimate over
 * the full vote log (settles, accounts for opponent strength) with bootstrap
 * rank ranges. Returns the leaderboard rows AND the model-level ratings — the
 * single source of truth that pairing and crowd-judgment also read (no separate
 * online-Elo system). This is the heavy compute (reads the whole log); callers
 * persist it via `recomputeStandings` and serve the cache, so it never runs on
 * the request path.
 */
const computeStandings = (
  state: StandingsState,
  events: VoteEvent[],
  totalUniqueVotes: number,
): StoredStandings => {
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

  const models = players
    .map((id): ArenaModelRow => {
      const model = MODELS_BY_ID.get(id)!;
      const counts = aggregateCounts(state, id);
      return {
        id,
        provider: PROVIDERS_BY_ID.get(model.providerId)!.name,
        model: model.name,
        elo: round2(ratings.get(id) ?? BT_CENTER),
        uncertainty: ratingStandardError(counts.voteCount),
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

  return {
    models,
    ratings: Object.fromEntries(players.map((id) => [id, ratings.get(id) ?? BT_CENTER])),
    totalUniqueVotes,
    asOf: new Date().toISOString(),
  };
};

/**
 * Refresh the cached Bradley–Terry fit every N recorded votes. The settled fit
 * barely moves vote-to-vote, and reads are also hourly-cached, so this only has
 * to be frequent enough to keep the blob current — not per-vote.
 */
export const STANDINGS_RECOMPUTE_INTERVAL = 50;

/**
 * Refit the Bradley–Terry standings over the whole vote log and persist them.
 * This is the only place the full log is read + fit; it runs in the background
 * on a vote interval (see the vote route's `after`) and from the migration
 * script, so every read path stays O(1).
 */
export const recomputeStandings = async (
  options: { concurrency?: number } = {},
): Promise<StoredStandings> => {
  const store = arenaStore();
  const [{ state, totalVotes }, events] = await Promise.all([
    store.load(),
    store.loadVoteEvents(options.concurrency),
  ]);
  const standings = computeStandings(state, events, totalVotes);
  await store.writeStandings(standings);
  return standings;
};

/**
 * The cached standings, computed on demand if the cache is cold (first run /
 * in-memory dev / tests). The cache is the fast path — a single blob read —
 * with the all-log fit as a fallback that never persists from a read.
 */
const loadStandings = async (): Promise<StoredStandings> => {
  const store = arenaStore();
  const cached = await store.loadStandings();
  if (cached) return cached;
  const [{ state, totalVotes }, events] = await Promise.all([
    store.load(),
    store.loadVoteEvents(),
  ]);
  return computeStandings(state, events, totalVotes);
};

export const getModels = async (): Promise<ModelsResponse> => {
  const { models, totalUniqueVotes } = await loadStandings();
  return { models, totalUniqueVotes };
};

/**
 * The live unique-vote total straight from the store — independent of the
 * cached Bradley–Terry fit (which only refreshes every
 * `STANDINGS_RECOMPUTE_INTERVAL` votes and is then hourly-cached). Reads serve
 * this for the counter so it stays in lockstep with `submitVote`'s returned
 * total, instead of snapping back to a stale "round" number on refresh. Cheap:
 * a snapshot read plus the pending-events tally the battle/vote paths already
 * do per request.
 */
export const getTotalUniqueVotes = async (): Promise<number> => {
  const { totalVotes } = await arenaStore().load();
  return totalVotes;
};

export type LiveModelCounts = {
  totalUniqueVotes: number;
  /** model id → live win/loss/tie/vote tally (snapshot + pending events). */
  counts: Record<string, ModelCounts>;
};

/**
 * Live per-model tallies straight from the store (snapshot + pending events),
 * independent of the settled Bradley–Terry fit. Read paths overlay these onto
 * the cached standings so a fresh vote's tally shows immediately while
 * rank/Humanness stay on the periodically-refit ratings. A single store load
 * serves both the counts and the live unique-vote total, so this replaces —
 * rather than adds to — the counter-only `getTotalUniqueVotes` on the read path.
 */
export const getLiveModelCounts = async (): Promise<LiveModelCounts> => {
  const { state, totalVotes } = await arenaStore().load();
  const counts: Record<string, ModelCounts> = {};
  for (const model of MODELS) {
    counts[model.id] = aggregateCounts(state, model.id);
  }
  return { totalUniqueVotes: totalVotes, counts };
};

export const createBattle = async (): Promise<BattleResponse> => {
  const store = arenaStore();
  // Pairing reads the snapshot rather than the exact counts: it only weights
  // coverage across 88 variants, so trailing the log by a few dozen votes is
  // invisible, and it keeps battle creation off the full event listing (which
  // grows by a blob round trip per 1,000 votes).
  const [{ state }, standings] = await Promise.all([
    store.loadSnapshotState(),
    store.loadStandings(),
  ]);
  // Close-matchup weighting reads the cached Bradley–Terry ratings (the same
  // numbers the leaderboard shows); cold cache → undefined → coverage-only
  // pairing until the first fit lands.
  const ratings = standings
    ? new Map(Object.entries(standings.ratings))
    : undefined;
  // The pair is two variants on a shared source voice that BOTH models serve
  // (chooseBattlePair groups by voice over the availability-restricted
  // VARIANTS matrix), so the clip URLs below always resolve — a model is never
  // asked for a voice it has no clips for.
  const [left, right] = chooseBattlePair(state, ratings);
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  const payload = {
    id: `battle:${randomUUID().replaceAll('-', '')}`,
    promptId: prompt.id,
    leftVariantId: left.id,
    rightVariantId: right.id,
    createdAt: Date.now(),
  };
  // Blind by design, and blind in fact: the response carries no model
  // identities, the matchup lives only inside the SEALED voteToken, and the
  // clip URLs are sealed too — the content-hash form would otherwise name each
  // model in its filename to anyone who reads this repo.
  return {
    id: payload.id,
    prompt: prompt.text,
    voteToken: battleTokenEncode(payload),
    leftAudioUrl: blindClipUrl(left.id, prompt.id),
    rightAudioUrl: blindClipUrl(right.id, prompt.id),
  };
};

export class VoteError extends Error {}

/**
 * This token can never succeed — the battle's one vote is already recorded, or
 * the token has aged out. Distinct from the other VoteErrors (which are
 * malformed input) because the client's only sensible response is to move on
 * to the next pairing.
 */
export class BattleAlreadyVotedError extends VoteError {}

/**
 * How long a battle stays votable. Battles are stateless — nothing exists
 * server-side until the vote — so without a deadline a token minted today is
 * spendable forever, and a script could bank thousands of pre-solved pairings
 * to cash in later. Hours of slack for a listener; useless as a stash.
 */
const BATTLE_TTL_MS = 2 * 60 * 60 * 1000;

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
  if (Date.now() - payload.createdAt > BATTLE_TTL_MS) {
    throw new BattleAlreadyVotedError('Battle expired');
  }
  const left = VARIANTS_BY_ID.get(payload.leftVariantId);
  const right = VARIANTS_BY_ID.get(payload.rightVariantId);
  if (!left || !right) throw new VoteError('Unknown battle variants');

  const store = arenaStore();
  // Only the cached standings (O(1) blob read) are needed before recording;
  // the live vote total comes back from `recordVote` itself, so the request
  // path no longer does a second full state load just to read the counter.
  const standings = await store.loadStandings();

  // "Correct" = the pick agreed with the crowd, judged on the cached
  // Bradley–Terry model ratings (the same numbers the leaderboard shows) so the
  // client never needs pre-vote identities to build the reveal. A settled fit
  // doesn't move on one vote, so reading the cache (not refitting) is exact
  // enough; cold cache → equal ratings → only an honest tie reads as "correct".
  const ratingOf = (modelId: string) => standings?.ratings[modelId] ?? BT_CENTER;
  const correct = voteMatchesCrowd(
    ratingOf(left.modelId),
    ratingOf(right.modelId),
    winner,
  );

  let totalVotes: number;
  try {
    ({ totalVotes } = await store.recordVote({
      id: `vote:${randomUUID().replaceAll('-', '')}`,
      battleId: payload.id,
      winner,
      leftVariantId: left.id,
      rightVariantId: right.id,
      createdAt: Date.now(),
    }));
  } catch (error) {
    if (error instanceof DuplicateVoteError) {
      throw new BattleAlreadyVotedError(error.message);
    }
    throw error;
  }

  // The reveal needs only each side's identity — the client builds rank +
  // Humanness from the standings it already holds. The published leaderboard is
  // the settled BT fit (refreshed in the background), so a single vote is not
  // echoed back as a reshuffle.
  return {
    reveal: {
      left: { modelId: left.modelId },
      right: { modelId: right.modelId },
    },
    correct,
    // `recordVote` loads state AFTER the write, so this already counts this vote.
    totalUniqueVotes: totalVotes,
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
