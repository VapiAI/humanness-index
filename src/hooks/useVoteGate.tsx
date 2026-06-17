'use client';

/**
 * CAPTCHA vote gate: every 10th vote (10, 20, 30, …) must pass a Cloudflare
 * Turnstile challenge before it is recorded. The cycle position is tracked in
 * localStorage (`hi-vote-count`); the solved token rides along with the gated
 * vote and is verified server-side (see ../server/turnstile.ts).
 *
 * Gracefully no-ops when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset: votes
 * pass straight through with no challenge, matching how the repo's other
 * integrations degrade without keys.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { TurnstileWidget } from '../components/TurnstileWidget';
import '../styles/vote-gate.css';

/** A challenge is required on every Nth vote. */
const CHALLENGE_EVERY = 10;
const VOTE_COUNT_KEY = 'hi-vote-count';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

const readVoteCount = (): number => {
  try {
    const parsed = Number.parseInt(
      window.localStorage.getItem(VOTE_COUNT_KEY) ?? '0',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

const writeVoteCount = (count: number) => {
  try {
    window.localStorage.setItem(VOTE_COUNT_KEY, String(count));
  } catch {
    // Private mode / storage disabled — the gate simply won't trigger.
  }
};

type VoteGate = {
  /**
   * Run `castVote` immediately, or — on every 10th vote when Turnstile is
   * configured — after the listener solves the challenge (which supplies the
   * `captchaToken`). Dismissing the challenge drops the vote and fires the
   * optional `onCancel` so the caller can release any in-flight lock.
   */
  guardVote: (
    castVote: (captchaToken?: string) => void,
    onCancel?: () => void,
  ) => void;
  /** The challenge modal; render it once near the page root. */
  challenge: ReactNode;
  /** True while the challenge modal is up (page shortcuts should stand down). */
  challengeOpen: boolean;
};

export const useVoteGate = (): VoteGate => {
  const pendingVoteRef = useRef<((captchaToken?: string) => void) | null>(null);
  const pendingCancelRef = useRef<(() => void) | null>(null);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeFailed, setChallengeFailed] = useState(false);

  const guardVote = useCallback<VoteGate['guardVote']>((castVote, onCancel) => {
    const nextCount = readVoteCount() + 1;
    if (!TURNSTILE_SITE_KEY || nextCount % CHALLENGE_EVERY !== 0) {
      writeVoteCount(nextCount);
      castVote();
      return;
    }
    pendingVoteRef.current = castVote;
    pendingCancelRef.current = onCancel ?? null;
    setChallengeFailed(false);
    setChallengeOpen(true);
  }, []);

  const handleToken = useCallback((token: string) => {
    const castVote = pendingVoteRef.current;
    pendingVoteRef.current = null;
    pendingCancelRef.current = null;
    setChallengeOpen(false);
    // Counting the gated vote restarts the 10-vote cycle.
    writeVoteCount(readVoteCount() + 1);
    castVote?.(token);
  }, []);

  const handleDismiss = useCallback(() => {
    const onCancel = pendingCancelRef.current;
    pendingVoteRef.current = null;
    pendingCancelRef.current = null;
    setChallengeOpen(false);
    // Let the caller re-enable voting — the round was never recorded.
    onCancel?.();
  }, []);

  useEffect(() => {
    if (!challengeOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleDismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [challengeOpen, handleDismiss]);

  const challenge = challengeOpen ? (
    <div
      className="hi-gate-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm you're human"
    >
      <div className="hi-gate-card">
        <h2 className="hi-gate-title">Quick human check</h2>
        <p className="hi-gate-note">
          A short check every {CHALLENGE_EVERY} votes keeps the rankings
          honest. Solve it and your vote goes through.
        </p>
        <TurnstileWidget
          siteKey={TURNSTILE_SITE_KEY}
          onToken={handleToken}
          onError={() => setChallengeFailed(true)}
        />
        {challengeFailed && (
          <p className="hi-gate-error">
            The check didn&apos;t load or expired. Close this and try voting
            again.
          </p>
        )}
        <button
          className="hi-gate-cancel"
          type="button"
          onClick={handleDismiss}
        >
          Cancel vote
        </button>
      </div>
    </div>
  ) : null;

  return { guardVote, challenge, challengeOpen };
};
