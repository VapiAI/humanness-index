import { NextResponse } from 'next/server';

import { submitVote, VoteError } from '@/server/arena';
import {
  checkVoteRateLimit,
  clientIpFrom,
} from '@/server/rateLimit';
import { verifyTurnstileToken } from '@/server/turnstile';

export async function POST(request: Request) {
  const clientIp = clientIpFrom(request);
  const limit = await checkVoteRateLimit(clientIp);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many votes. Slow down a moment.' },
      {
        status: 429,
        headers: { 'retry-after': String(limit.retryAfterSeconds) },
      },
    );
  }

  let body: { voteToken?: string; winner?: string; captchaToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // CAPTCHA gate (every 10th vote carries a token): no-op unless
  // TURNSTILE_SECRET_KEY is configured. See server/turnstile.ts.
  const captcha = await verifyTurnstileToken(
    typeof body.captchaToken === 'string' && body.captchaToken !== ''
      ? body.captchaToken
      : undefined,
    clientIp,
  );
  if (!captcha.ok) {
    console.warn('[humanness] turnstile verification failed:', captcha.reason);
    return NextResponse.json(
      { error: 'Human verification failed. Please try again.' },
      { status: 403 },
    );
  }

  try {
    return NextResponse.json(
      await submitVote(String(body.voteToken ?? ''), String(body.winner ?? '')),
    );
  } catch (error) {
    if (error instanceof VoteError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[humanness] vote failed:', error);
    return NextResponse.json(
      { error: 'Failed to record vote' },
      { status: 500 },
    );
  }
}
