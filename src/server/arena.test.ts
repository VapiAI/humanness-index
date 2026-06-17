/// <reference types="bun" />
import { beforeAll, describe, expect, it } from 'bun:test';

import { randomUUID } from 'node:crypto';

import {
  createBattle,
  getModels,
  getSample,
  recomputeStandings,
  submitVote,
  VoteError,
} from './arena';
import {
  battleTokenDecode,
  battleTokenEncode,
  type BattlePayload,
} from './battleToken';
import {
  audioUrlFor,
  MODELS_BY_ID,
  PROMPTS,
  PROMPTS_BY_ID,
  VARIANTS,
  VARIANTS_BY_ID,
  variantsOfModel,
} from './catalog';
import { arenaStore } from './store';

// Hermetic: force the in-memory store fallback (never touch Vercel Blob).
// The factory reads the env lazily on first arenaStore() call, which only
// happens inside test bodies, so deleting here (module scope) is early enough.
delete process.env.BLOB_READ_WRITE_TOKEN;

// NOTE: gradium-gradium-tts and minimax-minimax-tts are reserved for
// store.test.ts seed-fidelity assertions — never vote on them in this suite.
const variantOf = (modelId: string, index = 0) => {
  const variant = variantsOfModel(modelId)[index];
  if (!variant) throw new Error(`No variant ${index} for model ${modelId}`);
  return variant;
};

const tokenFor = (
  leftVariantId: string,
  rightVariantId: string,
  overrides: Partial<BattlePayload> = {},
) =>
  battleTokenEncode({
    id: `battle:${randomUUID().replaceAll('-', '')}`,
    promptId: 'clip-01',
    leftVariantId,
    rightVariantId,
    createdAt: Date.now(),
    ...overrides,
  });

/** The local Bun runner predates expect().rejects — assert rejections manually. */
const expectVoteError = async (promise: Promise<unknown>, message?: string) => {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(VoteError);
  if (message) expect((caught as Error).message).toBe(message);
};

describe('submitVote', () => {
  // Crowd-judgment reads the cached Bradley–Terry ratings; in production the
  // cache is always warm (migration + the background refit). Prime it here so
  // these tests exercise the real warm-cache path rather than the cold default.
  beforeAll(async () => {
    await recomputeStandings();
  });

  it('folds the win/loss into counts, increments totals, and reveals identities', async () => {
    const left = variantOf('xai-xai-tts');
    const right = variantOf('cartesia-sonic');
    const store = arenaStore();
    const before = await store.load();
    const leftBefore = before.state.get(left.id)!;
    const rightBefore = before.state.get(right.id)!;

    const response = await submitVote(tokenFor(left.id, right.id), 'left');

    const after = await store.load();
    const leftAfter = after.state.get(left.id)!;
    const rightAfter = after.state.get(right.id)!;
    expect(leftAfter.wins).toBe(leftBefore.wins + 1);
    expect(leftAfter.losses).toBe(leftBefore.losses);
    expect(leftAfter.ties).toBe(leftBefore.ties);
    expect(leftAfter.voteCount).toBe(leftBefore.voteCount + 1);
    expect(rightAfter.losses).toBe(rightBefore.losses + 1);
    expect(rightAfter.wins).toBe(rightBefore.wins);
    expect(rightAfter.voteCount).toBe(rightBefore.voteCount + 1);
    expect(after.totalVotes).toBe(before.totalVotes + 1);

    expect(response.totalUniqueVotes).toBe(before.totalVotes + 1);
    // The reveal carries only the two identities; the client builds rank +
    // Humanness from the standings it already holds.
    expect(response.reveal.left.modelId).toBe('xai-xai-tts');
    expect(response.reveal.right.modelId).toBe('cartesia-sonic');
    // Picking the heavy favorite (xAI over Sonic) agrees with the crowd.
    expect(response.correct).toBe(true);
  });

  it('tallies the win/loss when the right side wins', async () => {
    const left = variantOf('canopy-orpheus');
    const right = variantOf('cartesia-sonic-2');
    const store = arenaStore();
    const before = await store.load();
    const leftBefore = before.state.get(left.id)!;
    const rightBefore = before.state.get(right.id)!;

    await submitVote(tokenFor(left.id, right.id), 'right');

    const after = await store.load();
    expect(after.state.get(right.id)!.wins).toBe(rightBefore.wins + 1);
    expect(after.state.get(left.id)!.losses).toBe(leftBefore.losses + 1);
    expect(after.state.get(right.id)!.voteCount).toBe(rightBefore.voteCount + 1);
    expect(after.state.get(left.id)!.voteCount).toBe(leftBefore.voteCount + 1);
  });

  it('on a tie, increments only the tie counts on both sides', async () => {
    const left = variantOf('xai-xai-tts', 1);
    const right = variantOf('cartesia-sonic', 1);
    const store = arenaStore();
    const before = await store.load();
    const leftBefore = before.state.get(left.id)!;
    const rightBefore = before.state.get(right.id)!;

    await submitVote(tokenFor(left.id, right.id), 'tie');

    const after = await store.load();
    const leftAfter = after.state.get(left.id)!;
    const rightAfter = after.state.get(right.id)!;
    expect(leftAfter.ties).toBe(leftBefore.ties + 1);
    expect(rightAfter.ties).toBe(rightBefore.ties + 1);
    expect(leftAfter.wins).toBe(leftBefore.wins);
    expect(leftAfter.losses).toBe(leftBefore.losses);
    expect(rightAfter.wins).toBe(rightBefore.wins);
    expect(rightAfter.losses).toBe(rightBefore.losses);
    expect(leftAfter.voteCount).toBe(leftBefore.voteCount + 1);
    expect(rightAfter.voteCount).toBe(rightBefore.voteCount + 1);
  });

  it('rejects winners that are not left/right/tie (you cannot vote a model id)', async () => {
    const token = tokenFor(
      variantOf('xai-xai-tts').id,
      variantOf('cartesia-sonic').id,
    );
    await expectVoteError(
      submitVote(token, 'both'),
      'Winner must be left, right, or tie',
    );
    // Naming a model directly — even one in the battle — is not a valid winner.
    await expectVoteError(
      submitVote(token, 'xai-xai-tts'),
      'Winner must be left, right, or tie',
    );
  });

  it('rejects a tampered token (re-encoded without re-signing)', async () => {
    const token = tokenFor(
      variantOf('xai-xai-tts').id,
      variantOf('cartesia-sonic').id,
    );
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    decoded.payload.rightVariantId = variantOf('cartesia-sonic-3').id;
    const forged = Buffer.from(JSON.stringify(decoded), 'utf-8').toString(
      'base64url',
    );
    await expectVoteError(submitVote(forged, 'left'), 'Invalid battle token');
  });

  it('rejects garbage and empty tokens', async () => {
    await expectVoteError(
      submitVote('definitely-not-a-token', 'left'),
      'Invalid battle token',
    );
    await expectVoteError(submitVote('', 'tie'));
  });

  it('rejects a properly signed token whose variants are not in the catalog', async () => {
    const token = tokenFor(
      'variant:voice-clara:acme:fake-model',
      variantOf('cartesia-sonic').id,
    );
    await expectVoteError(submitVote(token, 'left'), 'Unknown battle variants');
  });

  it('rejects double-voting the same battle token and leaves totals untouched', async () => {
    const token = tokenFor(
      variantOf('inworld-tts-2').id,
      variantOf('elevenlabs-flash-v2').id,
    );
    await submitVote(token, 'left');
    const before = await arenaStore().load();
    await expectVoteError(
      submitVote(token, 'right'),
      'Battle has already been voted on',
    );
    const after = await arenaStore().load();
    expect(after.totalVotes).toBe(before.totalVotes);
  });

  it('documents current behavior: tokens carry no TTL, stale createdAt is accepted', async () => {
    // There is no expiry check on createdAt (battleTokenDecode and submitVote
    // both ignore it). Replay is bounded only by the single-use battle id.
    const token = tokenFor(
      variantOf('inworld-tts-15-max').id,
      variantOf('elevenlabs-turbo-v2').id,
      { createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 },
    );
    const response = await submitVote(token, 'tie');
    expect(response.reveal.left.modelId).toBe('inworld-tts-15-max');
  });
});

describe('createBattle', () => {
  it('is blind: no model ids in the response, identities only in the signed token', async () => {
    const battle = await createBattle();
    // Integrity: the wire response carries no identities (blind until vote).
    expect('leftModelId' in battle).toBe(false);
    expect('rightModelId' in battle).toBe(false);

    // The matchup is recoverable only by decoding the signed token (server-side).
    const payload = battleTokenDecode(battle.voteToken);
    expect(payload.id).toBe(battle.id);
    const left = VARIANTS_BY_ID.get(payload.leftVariantId)!;
    const right = VARIANTS_BY_ID.get(payload.rightVariantId)!;
    expect(left.modelId).not.toBe(right.modelId);
    expect(MODELS_BY_ID.has(left.modelId)).toBe(true);
    expect(MODELS_BY_ID.has(right.modelId)).toBe(true);
    expect(PROMPTS_BY_ID.get(payload.promptId)?.text).toBe(battle.prompt);
    expect(battle.leftAudioUrl).toMatch(/^https:\/\/.+\.mp3$/);
    expect(battle.rightAudioUrl).toMatch(/^https:\/\/.+\.mp3$/);
  });

  it('never pairs a model against itself; pairs share a source voice (25 draws)', async () => {
    for (let i = 0; i < 25; i += 1) {
      const battle = await createBattle();
      const payload = battleTokenDecode(battle.voteToken);
      const left = VARIANTS_BY_ID.get(payload.leftVariantId)!;
      const right = VARIANTS_BY_ID.get(payload.rightVariantId)!;
      expect(left.modelId).not.toBe(right.modelId);
      expect(left.sourceVoiceId).toBe(right.sourceVoiceId);
    }
  });

  it('only pairs the Human baseline on a recorded voice, and keeps the voice mix even', async () => {
    let humanBattles = 0;
    const voicesSeen = new Set<string>();
    for (let i = 0; i < 120; i += 1) {
      const battle = await createBattle();
      const payload = battleTokenDecode(battle.voteToken);
      const left = VARIANTS_BY_ID.get(payload.leftVariantId)!;
      const right = VARIANTS_BY_ID.get(payload.rightVariantId)!;
      // (A) Same source voice on both sides, always (so both clips resolve).
      expect(left.sourceVoiceId).toBe(right.sourceVoiceId);
      voicesSeen.add(left.sourceVoiceId);
      if (left.modelId !== 'human' && right.modelId !== 'human') continue;
      humanBattles += 1;
      const human = left.modelId === 'human' ? left : right;
      expect([
        'voice-clara',
        'voice-nelliot',
        'voice-godfrey',
        'voice-emma',
      ]).toContain(human.sourceVoiceId);
    }
    // The Human baseline is unseeded (0 votes), so coverage forcing still
    // surfaces it (on its recorded voices) well within the draws...
    expect(humanBattles).toBeGreaterThan(0);
    // ...but (B) the schedule is no longer collapsed onto the Human baseline's
    // recorded voices: all four roster voices come up.
    expect(voicesSeen).toEqual(
      new Set(['voice-clara', 'voice-emma', 'voice-godfrey', 'voice-nelliot']),
    );
  });
});

describe('getModels', () => {
  it('returns the full Bradley–Terry leaderboard with the store vote total', async () => {
    // getModels serves the cached fit; refresh it so the total matches the
    // store after this suite's votes (the background refit's role in prod).
    await recomputeStandings();
    const snapshot = await arenaStore().load();
    const { models, totalUniqueVotes } = await getModels();
    expect(totalUniqueVotes).toBe(snapshot.totalVotes);
    const allModelIds = new Set(VARIANTS.map((variant) => variant.modelId));
    expect(models.length).toBe(allModelIds.size);
    for (let i = 1; i < models.length; i += 1) {
      expect(models[i - 1].elo).toBeGreaterThanOrEqual(models[i].elo);
    }
    for (const row of models) {
      expect(allModelIds.has(row.id)).toBe(true);
      expect(row.rankRange).toMatch(/^#\d+(-\d+)?$/);
      expect(row.provider.length).toBeGreaterThan(0);
      expect(row.model.length).toBeGreaterThan(0);
    }
  });
});

describe('getSample', () => {
  it('returns a hosted clip and prompt text for a known model', async () => {
    const sample = await getSample('xai-xai-tts');
    expect(sample.audioUrl).toMatch(/^https:\/\/.+\.mp3$/);
    const promptTexts = new Set([...PROMPTS_BY_ID.values()].map((p) => p.text));
    expect(promptTexts.has(sample.prompt)).toBe(true);
  });

  it('rejects an unknown model id', async () => {
    await expectVoteError(getSample('not-a-model'));
  });

  it('excludes the battle voice for a model in the battle (decoded from the token)', async () => {
    const battleLeft = variantOf('xai-xai-tts'); // voice-clara
    const battleRight = variantsOfModel('cartesia-sonic').find(
      (variant) => variant.sourceVoiceId === battleLeft.sourceVoiceId,
    )!;
    const token = tokenFor(battleLeft.id, battleRight.id, { promptId: 'clip-05' });
    // Every clip xAI could produce on the battle's source voice — a battling
    // model's sample must avoid all of them (different voice = different audio),
    // so a labeled Listen clip can never byte-match the blind card.
    const battleVoiceUrls = new Set(
      variantsOfModel('xai-xai-tts')
        .filter((variant) => variant.sourceVoiceId === battleLeft.sourceVoiceId)
        .flatMap((variant) => PROMPTS.map((prompt) => audioUrlFor(variant.id, prompt.id))),
    );
    for (let i = 0; i < 30; i += 1) {
      const sample = await getSample('xai-xai-tts', { battleToken: token });
      expect(battleVoiceUrls.has(sample.audioUrl)).toBe(false);
    }
  });

  it('samples a non-battling model normally even when a battle token is passed', async () => {
    const battleLeft = variantOf('xai-xai-tts');
    const battleRight = variantsOfModel('cartesia-sonic').find(
      (variant) => variant.sourceVoiceId === battleLeft.sourceVoiceId,
    )!;
    const token = tokenFor(battleLeft.id, battleRight.id);
    // Not in the battle → no exclusion, any voice/prompt is valid.
    const sample = await getSample('elevenlabs-flash-v2', { battleToken: token });
    expect(sample.audioUrl).toMatch(/^https:\/\/.+\.mp3$/);
  });
});
