/**
 * Stateless battle tokens — the token round-trips through the client and is
 * decoded on vote, so a battle never needs server-side persistence.
 *
 * The payload names both models, so it is SEALED rather than merely signed.
 * The original scheme (HMAC over base64url'd JSON) was tamper-proof but
 * readable: one `atob()` on the token handed out with a blind battle revealed
 * the matchup before voting. Sealing keeps the same round trip and adds the
 * integrity guarantee via AES-GCM's auth tag.
 */
import { seal, unseal } from './opaque';

export type BattlePayload = {
  id: string;
  promptId: string;
  leftVariantId: string;
  rightVariantId: string;
  createdAt: number;
};

const LABEL = 'battle-token';

export const battleTokenEncode = (payload: BattlePayload): string =>
  seal(LABEL, JSON.stringify(payload));

export const battleTokenDecode = (token: string): BattlePayload => {
  const plaintext = unseal(LABEL, token);
  if (plaintext === null) throw new Error('Invalid battle token');
  try {
    return JSON.parse(plaintext) as BattlePayload;
  } catch {
    throw new Error('Invalid battle token');
  }
};
