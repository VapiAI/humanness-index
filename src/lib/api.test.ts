/// <reference types="bun" />
import { afterEach, describe, expect, it } from 'bun:test';

import { BattleSpentError, submitVote } from './api';

const realFetch = globalThis.fetch;

/** Answer the next /api/vote POST with a fixed status + body. */
const stubVoteResponse = (status: number, body: unknown) => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('submitVote', () => {
  it('maps 409 to BattleSpentError so the round can skip ahead', async () => {
    stubVoteResponse(409, { error: 'Battle has already been voted on' });
    await expect(submitVote('token', 'left')).rejects.toBeInstanceOf(
      BattleSpentError,
    );
  });

  it('leaves other failures as plain errors (the round stays put)', async () => {
    stubVoteResponse(500, { error: 'Failed to record vote' });
    await expect(submitVote('token', 'left')).rejects.not.toBeInstanceOf(
      BattleSpentError,
    );
  });

  it('returns the parsed reveal on success', async () => {
    const payload = {
      reveal: { left: { modelId: 'a' }, right: { modelId: 'b' } },
      correct: true,
      totalUniqueVotes: 12,
    };
    stubVoteResponse(200, payload);
    expect(await submitVote('token', 'tie')).toEqual(payload);
  });
});
