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
import { clientIpFrom } from './rateLimit';

// Hermetic: in-memory store (no Vercel Blob), in-memory rate limiter (no
// Upstash), and a no-op Turnstile gate. All of these read env lazily, so
// clearing here — before any test body runs — is early enough.
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.TURNSTILE_SECRET_KEY;

/** Rate-limit buckets are per IP and shared module state — isolate each test. */
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
    expect(battle.leftAudioUrl).toMatch(/^https:\/\/.+\.mp3$/);
    expect(battle.rightAudioUrl).toMatch(/^https:\/\/.+\.mp3$/);
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
      expect(body.reveal.left.modelId).toBe('canopy-orpheus');
      expect(body.reveal.right.modelId).toBe('cartesia-sonic-2');
      expect(typeof body.reveal.left.eloDelta).toBe('number');
      expect(typeof body.correct).toBe('boolean');
      expect(Array.isArray(body.models)).toBe(true);
      expect(body.models.length).toBeGreaterThan(0);
      expect(typeof body.totalUniqueVotes).toBe('number');
    } finally {
      globalThis.fetch = realFetch;
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

  it('rejects a second vote on the same battle token with a 400', async () => {
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
    expect(second.status).toBe(400);
    const body = await second.json();
    expect(body.error).toMatch(/already been voted/);
  });

  it('rate limits the 41st request in a window with 429 + retry-after', async () => {
    const ip = uniqueIp();
    // The limiter runs before body parsing, so cheap invalid payloads each
    // consume a slot (40 allowed per 60s fixed window).
    for (let i = 0; i < 40; i += 1) {
      const response = await postVote('{}', ip);
      expect(response.status).toBe(400);
    }
    const limited = await postVote('{}', ip);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: 'Too many votes. Slow down a moment.',
    });
    const retryAfter = Number(limited.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);

    // The window is per IP: other clients are unaffected.
    const other = await postVote('{}', uniqueIp());
    expect(other.status).toBe(400);
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
