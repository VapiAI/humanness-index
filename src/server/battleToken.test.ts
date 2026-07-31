/// <reference types="bun" />
import { describe, expect, it } from 'bun:test';

import { battleTokenDecode, battleTokenEncode, type BattlePayload } from './battleToken';

const payload: BattlePayload = {
  id: 'battle:abc123',
  promptId: 'clip-04',
  leftVariantId: 'variant:voice-clara:xai:xai-tts',
  rightVariantId: 'variant:voice-clara:cartesia:sonic',
  createdAt: 1_700_000_000_000,
};

describe('battleToken', () => {
  it('round-trips a payload', () => {
    expect(battleTokenDecode(battleTokenEncode(payload))).toEqual(payload);
  });

  it('does not expose the matchup to whoever holds the token', () => {
    const token = battleTokenEncode(payload);
    const raw = Buffer.from(token, 'base64url').toString('binary');
    for (const secret of [payload.leftVariantId, payload.rightVariantId, payload.promptId]) {
      expect(token).not.toContain(secret);
      expect(raw).not.toContain(secret);
    }
  });

  it('seals the same payload differently every time', () => {
    expect(battleTokenEncode(payload)).not.toBe(battleTokenEncode(payload));
  });

  it('rejects a tampered payload (forged winner-friendly variant)', () => {
    const raw = Buffer.from(battleTokenEncode(payload), 'base64url');
    // Flip a ciphertext bit — GCM's auth tag must catch it.
    raw[raw.length - 1] ^= 0xff;
    expect(() => battleTokenDecode(raw.toString('base64url'))).toThrow(
      'Invalid battle token',
    );
  });

  it('rejects a garbage token', () => {
    expect(() => battleTokenDecode('not-a-real-token')).toThrow('Invalid battle token');
  });

  it('rejects a payload sealed with a different secret', () => {
    const token = battleTokenEncode(payload);
    process.env.HUMANNESS_BATTLE_TOKEN_SECRET = 'a-different-secret';
    try {
      expect(() => battleTokenDecode(token)).toThrow('Invalid battle token');
    } finally {
      delete process.env.HUMANNESS_BATTLE_TOKEN_SECRET;
    }
  });
});
