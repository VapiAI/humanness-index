/// <reference types="bun" />
import { describe, expect, it } from 'bun:test';

import { randomUUID } from 'node:crypto';

import { GET as getBattleRoute } from '../../app/api/battle/route';
import { POST as postVoteRoute } from '../../app/api/vote/route';

import { battleTokenDecode, battleTokenEncode } from './battleToken';
import {
  MODELS_BY_ID,
  PROMPTS_BY_ID,
  VARIANTS_BY_ID,
  variantsOfModel,
} from './catalog';
import { clientIpFrom } from './turnstile';

// Hermetic: in-memory store (no Vercel Blob) and a no-op Turnstile gate. Both
// read env lazily, so clearing here — before any test body runs — is early
// enough.
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.TURNSTILE_SECRET_KEY;

let ipSequence = 0;
const uniqueIp = () => {
  ipSequence += 1;
  return `198.51.${Math.floor(ipSequence / 250)}.${ipSequence % 250}`;
};

const postVote = (body: string, ip: string) =>
  postVoteRoute(
    new Request('http://localhost/api/vote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body,
    }),
  );

// NOTE: gradium-gradium-tts and minimax-minimax-tts are reserved for
// store.test.ts seed-fidelity assertions — never vote on them here.
const freshVoteToken = () =>
  battleTokenEncode({
    id: `battle:${randomUUID().replaceAll('-', '')}`,
    promptId: 'clip-02',
    leftVariantId: variantsOfModel('canopy-orpheus')[0].id,
    rightVariantId: variantsOfModel('cartesia-sonic-2')[0].id,
    createdAt: Date.now(),
  });

describe('GET /api/battle', () => {
  it('returns a battle whose token is consistent with the announced pairing', async () => {
    const response = await getBattleRoute();
    expect(response.status).toBe(200);
    const battle = await response.json();
    // Blind: no identities on the wire; the matchup lives only in the token.
    expect(battle.leftModelId).toBeUndefined();
    expect(battle.rightModelId).toBeUndefined();
    const payload = battleTokenDecode(battle.voteToken);
    expect(payload.id).toBe(battle.id);
    const left = VARIANTS_BY_ID.get(payload.leftVariantId)!;
    const right = VARIANTS_BY_ID.get(payload.rightVariantId)!;
    expect(left.modelId).not.toBe(right.modelId);
    expect(MODELS_BY_ID.has(left.modelId)).toBe(true);
    expect(MODELS_BY_ID.has(right.modelId)).toBe(true);
    expect(PROMPTS_BY_ID.get(payload.promptId)?.text).toBe(battle.prompt);
    expect(battle.leftAudioUrl).toMatch(/^\/audio\/[A-Za-z0-9_-]+\.mp3$/);
    expect(battle.rightAudioUrl).toMatch(/^\/audio\/[A-Za-z0-9_-]+\.mp3$/);
    expect(battle.leftAudioUrl).not.toContain(payload.leftVariantId);
    expect(battle.rightAudioUrl).not.toContain(payload.rightVariantId);
  });
});

describe('POST /api/vote', () => {
  it('records a valid vote without any network access (store + captcha gate off)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('network access attempted in a hermetic test');
    }) as unknown as typeof fetch;
    try {
      const response = await postVote(
        JSON.stringify({
          voteToken: freshVoteToken(),
          winner: 'left',
          // Unverifiable token: ignored because TURNSTILE_SECRET_KEY is unset.
          captchaToken: 'not-checked-when-gate-is-off',
        }),
        uniqueIp(),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      // The reveal carries only identities now (the client builds rank +
      // Humanness from the standings it holds); no per-vote leaderboard echo.
      expect(body.reveal.left.modelId).toBe('canopy-orpheus');
      expect(body.reveal.right.modelId).toBe('cartesia-sonic-2');
      expect(typeof body.correct).toBe('boolean');
      expect(typeof body.totalUniqueVotes).toBe('number');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('rejects a token-less vote once the captcha gate is configured', async () => {
    // The gate is only worth anything if omitting the field fails; a script
    // that skips the challenge must not vote.
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    try {
      const response = await postVote(
        JSON.stringify({ voteToken: freshVoteToken(), winner: 'left' }),
        uniqueIp(),
      );
      expect(response.status).toBe(403);
    } finally {
      delete process.env.TURNSTILE_SECRET_KEY;
    }
  });

  it('rejects malformed JSON with a 400 and a bare error shape', async () => {
    const response = await postVote('this is { not json', uniqueIp());
    expect(response.status).toBe(400);
    // Exact match: a single error key, no stack traces or internals.
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('rejects bad payloads with 400s that do not leak internals', async () => {
    const missingWinner = await postVote(
      JSON.stringify({ voteToken: freshVoteToken() }),
      uniqueIp(),
    );
    expect(missingWinner.status).toBe(400);
    expect(await missingWinner.json()).toEqual({
      error: 'Winner must be left, right, or tie',
    });

    const garbageToken = await postVote(
      JSON.stringify({ voteToken: 'garbage', winner: 'left' }),
      uniqueIp(),
    );
    expect(garbageToken.status).toBe(400);
    expect(await garbageToken.json()).toEqual({
      error: 'Invalid battle token',
    });
  });

  // 409, not 400: the client tells a spent pairing apart from a malformed one
  // so it can skip ahead to the next battle instead of retrying a dead round.
  it('rejects a second vote on the same battle token with a 409', async () => {
    const voteToken = freshVoteToken();
    const first = await postVote(
      JSON.stringify({ voteToken, winner: 'tie' }),
      uniqueIp(),
    );
    expect(first.status).toBe(200);

    const second = await postVote(
      JSON.stringify({ voteToken, winner: 'left' }),
      uniqueIp(),
    );
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error).toMatch(/already been voted/);
  });

  // Rate limiting is intentionally absent from this route: it lives in Vercel
  // Firewall rules on /api/vote, ahead of the function. Nothing to assert here
  // — an in-process limiter is what previously made the endpoint look
  // protected while counting per lambda.
  it('does not rate limit in application code, however many requests arrive', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 50; i += 1) {
      expect((await postVote('{}', ip)).status).toBe(400);
    }
  });
});

describe('clientIpFrom', () => {
  const requestWithHeaders = (headers: Record<string, string>) =>
    new Request('http://localhost/api/vote', { headers });

  it('takes the first hop of x-forwarded-for', () => {
    const request = requestWithHeaders({
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
    });
    expect(clientIpFrom(request)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then to "unknown"', () => {
    expect(
      clientIpFrom(requestWithHeaders({ 'x-real-ip': ' 203.0.113.9 ' })),
    ).toBe('203.0.113.9');
    expect(clientIpFrom(requestWithHeaders({}))).toBe('unknown');
  });
});
