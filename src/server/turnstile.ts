/**
 * Cloudflare Turnstile verification for the vote endpoint. Every vote must
 * carry a freshly solved token (see ../hooks/useVoteGate, which keeps one warm
 * so the check stays invisible); this module verifies it server-side.
 *
 * Rate limiting is NOT here and is not in application code at all: it runs as
 * Vercel Firewall rules on /api/vote, at the edge ahead of this function. That
 * is deliberate — the previous in-process limiter counted per lambda, so on
 * serverless it counted almost nothing while still reading as protection.
 *
 * Mirrors the repo's optional-integration pattern (see
 * src/app/api/call/redis-client.ts / env-validator.ts): when the env vars are
 * missing the whole gate gracefully no-ops and voting works exactly as before.
 *
 * Environment variables (set BOTH in Vercel to activate the gate):
 * - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — widget site key (client; solves the
 *   challenge in the background).
 * - `TURNSTILE_SECRET_KEY` — siteverify secret (server; validates tokens).
 */

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export const clientIpFrom = (request: Request): string => {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
};

type TurnstileVerification = {
  ok: boolean;
  /** Cloudflare error codes when verification failed (for logging). */
  reason?: string;
};

/**
 * Verifies a Turnstile token against Cloudflare's siteverify endpoint.
 *
 * Once `TURNSTILE_SECRET_KEY` is set the gate is mandatory: a vote without a
 * token is rejected, so a script has to solve a challenge per vote rather than
 * simply omitting the field. With the secret unset it no-ops (local dev, tests).
 */
export const verifyTurnstileToken = async (
  token: string | undefined,
  remoteIp: string,
): Promise<TurnstileVerification> => {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { ok: true };
  if (!token) return { ok: false, reason: 'missing token' };

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
    // Fail open only on an outage: an attacker can't make siteverify
    // unreachable from Vercel, but Cloudflare having a bad day shouldn't take
    // voting down with it.
    console.warn('[humanness] turnstile siteverify unavailable:', error);
    return { ok: true };
  }
};
