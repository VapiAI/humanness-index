/**
 * Cloudflare Turnstile verification for the vote endpoint — the anti-abuse
 * CAPTCHA gate that sits on top of the per-IP rate limit. The client asks for
 * a challenge every 10th vote (see ../hooks/useVoteGate) and attaches the
 * solved token to that vote; this module verifies it server-side.
 *
 * Mirrors the repo's optional-integration pattern (see
 * src/app/api/call/redis-client.ts / env-validator.ts): when the env vars are
 * missing the whole gate gracefully no-ops and voting works exactly as before.
 *
 * Environment variables (set BOTH in Vercel to activate the gate):
 * - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — widget site key (client; renders the
 *   challenge on every 10th vote).
 * - `TURNSTILE_SECRET_KEY` — siteverify secret (server; validates tokens).
 */

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

type TurnstileVerification = {
  ok: boolean;
  /** Cloudflare error codes when verification failed (for logging). */
  reason?: string;
};

/**
 * Verifies a Turnstile token against Cloudflare's siteverify endpoint.
 *
 * Pragmatic gating (standings aren't security-critical): only votes that
 * carry a token are verified — the client decides the every-10 cadence, and
 * token-less votes still pass through the per-IP rate limit. When
 * `TURNSTILE_SECRET_KEY` is unset, verification is skipped entirely (no-op).
 */
export const verifyTurnstileToken = async (
  token: string | undefined,
  remoteIp: string,
): Promise<TurnstileVerification> => {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret || !token) return { ok: true };

  try {
    const params = new URLSearchParams({ secret, response: token });
    if (remoteIp && remoteIp !== 'unknown') params.set('remoteip', remoteIp);

    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!response.ok) {
      throw new Error(`siteverify responded ${response.status}`);
    }
    const result = (await response.json()) as {
      success: boolean;
      'error-codes'?: string[];
    };
    if (result.success) return { ok: true };
    return {
      ok: false,
      reason: result['error-codes']?.join(', ') || 'verification failed',
    };
  } catch (error) {
    // Cloudflare being unreachable shouldn't take voting down with it.
    console.warn('[humanness] turnstile siteverify unavailable:', error);
    return { ok: true };
  }
};
