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

  it('rejects a tampered payload (forged winner-friendly variant)', () => {
    const token = battleTokenEncode(payload);
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    decoded.payload.leftVariantId = 'variant:voice-clara:xai:pro-streaming';
    const forged = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url');
    expect(() => battleTokenDecode(forged)).toThrow('Invalid battle token');
  });

  it('rejects a garbage token', () => {
    expect(() => battleTokenDecode('not-a-real-token')).toThrow('Invalid battle token');
  });

  it('rejects a payload signed with a different secret', () => {
    const token = battleTokenEncode(payload);
    process.env.HUMANNESS_BATTLE_TOKEN_SECRET = 'a-different-secret';
    try {
      expect(() => battleTokenDecode(token)).toThrow('Invalid battle token');
    } finally {
      delete process.env.HUMANNESS_BATTLE_TOKEN_SECRET;
    }
  });
});
