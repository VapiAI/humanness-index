/**
 * Stateless signed battle tokens — the original prototype's scheme
 * (HMAC-SHA256 over the canonical JSON payload, base64url of
 * {payload, signature}). The battle never needs server-side persistence: the
 * token round-trips through the client and is verified on vote.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type BattlePayload = {
  id: string;
  promptId: string;
  leftVariantId: string;
  rightVariantId: string;
  createdAt: number;
};

const secret = () =>
  process.env.HUMANNESS_BATTLE_TOKEN_SECRET ?? 'humanness-local-battle-token-secret';

const canonical = (payload: BattlePayload): string =>
  JSON.stringify(payload, Object.keys(payload).sort());

const sign = (serialized: string): string =>
  createHmac('sha256', secret()).update(serialized).digest('hex');

export const battleTokenEncode = (payload: BattlePayload): string => {
  const serialized = canonical(payload);
  const token = JSON.stringify({ payload, signature: sign(serialized) });
  return Buffer.from(token, 'utf-8').toString('base64url');
};

export const battleTokenDecode = (token: string): BattlePayload => {
  let parsed: { payload?: BattlePayload; signature?: string };
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
  } catch {
    throw new Error('Invalid battle token');
  }
  const { payload, signature } = parsed;
  if (!payload || typeof signature !== 'string') {
    throw new Error('Invalid battle token');
  }
  const expected = sign(canonical(payload));
  const expectedBuffer = Buffer.from(expected, 'utf-8');
  const signatureBuffer = Buffer.from(signature, 'utf-8');
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    throw new Error('Invalid battle token');
  }
  return payload;
};
