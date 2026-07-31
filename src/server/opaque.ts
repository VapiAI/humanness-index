/**
 * Authenticated encryption for values that round-trip through the browser but
 * must not be readable by it — battle tokens and blind clip URLs.
 *
 * AES-256-GCM, so the auth tag doubles as the integrity check a bare HMAC used
 * to provide: a sealed value is opaque *and* tamper-evident. A fresh IV per
 * call means the same plaintext seals differently every time, so a value
 * harvested from one battle reveals nothing about the next.
 *
 * `label` domain-separates the uses (a clip id can't be replayed as a battle
 * token) and the key derives from `HUMANNESS_BATTLE_TOKEN_SECRET`, read at call
 * time so tests can swap it.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

const keyFor = (label: string): Buffer =>
  createHash('sha256')
    .update(
      `${process.env.HUMANNESS_BATTLE_TOKEN_SECRET ?? 'humanness-local-battle-token-secret'}|${label}`,
    )
    .digest();

export const seal = (label: string, plaintext: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFor(label), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
};

/** The sealed plaintext, or null if it was forged, truncated, or sealed elsewhere. */
export const unseal = (label: string, sealed: string): string | null => {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFor(label),
      raw.subarray(0, IV_BYTES),
    );
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf-8');
  } catch {
    return null;
  }
};
