'use client';

/**
 * Check each vote in a visible dialog. A hidden background challenge can fail
 * before a listener votes; clearing that error without restarting the widget
 * left the old gate waiting forever. Each vote/retry now mounts a fresh check.
 * The vote stays pending until verification succeeds or the listener cancels.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { TurnstileWidget } from '../components/TurnstileWidget';
import '../styles/vote-gate.css';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
export const VOTE_CHECK_TIMEOUT_MS = 60_000;

type PendingVote = {
  cast: (captchaToken?: string) => void;
  cancel?: () => void;
};

type VoteGate = {
  guardVote: (castVote: (captchaToken?: string) => void, onCancel?: () => void) => void;
  challenge: ReactNode;
  challengeOpen: boolean;
};

const errorMessage = (code: string) => {
  if (code === '110200') return 'The security check is not configured for this site. Please contact us.';
  if (code === 'script-load') return 'The security check could not load. Check your connection or browser content blocker, then retry.';
  if (code === 'timeout' || code === 'expired') return 'The security check timed out. Please retry.';
  return 'Cloudflare could not verify this browser. Please retry, or try another browser if it keeps failing.';
};

export const useVoteGate = (): VoteGate => {
  const pendingRef = useRef<PendingVote | null>(null);
  // Reject late callbacks from failed, dismissed or already spent challenges.
  const acceptingRef = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const guardVote = useCallback<VoteGate['guardVote']>((castVote, onCancel) => {
    if (!TURNSTILE_SITE_KEY) { castVote(); return; }
    if (pendingRef.current) return;
    pendingRef.current = { cast: castVote, cancel: onCancel };
    acceptingRef.current = true;
    setError(null);
    setReady(false);
    setAttempt((count) => count + 1);
    setWaiting(true);
  }, []);

  const handleToken = useCallback((token: string) => {
    if (!acceptingRef.current || !token) return;
    const pending = pendingRef.current;
    pendingRef.current = null;
    acceptingRef.current = false;
    setWaiting(false);
    pending?.cast(token);
  }, []);

  const handleError = useCallback((code: string) => {
    if (!acceptingRef.current) return;
    acceptingRef.current = false;
    console.warn('[humanness] Turnstile check failed:', code);
    setError(code);
  }, []);

  const handleReady = useCallback(() => {
    if (acceptingRef.current) setReady(true);
  }, []);

  const handleRetry = useCallback(() => {
    if (!pendingRef.current) return;
    acceptingRef.current = true;
    setError(null);
    setReady(false);
    setAttempt((count) => count + 1);
  }, []);

  const handleDismiss = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    acceptingRef.current = false;
    setWaiting(false);
    setError(null);
    pending?.cancel?.();
  }, []);

  useEffect(() => {
    if (!waiting || error) return;
    const timeout = setTimeout(() => handleError('timeout'), VOTE_CHECK_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [waiting, error, attempt, handleError]);

  useEffect(() => {
    if (!waiting) return;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleDismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [waiting, handleDismiss]);

  useEffect(() => () => {
    acceptingRef.current = false;
    const pending = pendingRef.current;
    pendingRef.current = null;
    pending?.cancel?.();
  }, []);

  const challenge = TURNSTILE_SITE_KEY && waiting ? (
    <div className="hi-gate-overlay" role="dialog" aria-modal="true" aria-labelledby="hi-gate-title">
      <div className="hi-gate-card">
        <h2 className="hi-gate-title" id="hi-gate-title">Quick human check</h2>
        <p className="hi-gate-note">One short check keeps the rankings honest. Your vote is sent only after verification succeeds.</p>
        {error ? (
          <>
            <p className="hi-gate-error" role="alert">{errorMessage(error)} Your vote has not been sent.</p>
            <button className="hi-gate-retry" type="button" onClick={handleRetry}>Retry check</button>
          </>
        ) : (
          <>
            <p className="hi-gate-status" role="status">{ready ? 'Verifying your browser…' : 'Loading security check…'}</p>
            <TurnstileWidget key={attempt} siteKey={TURNSTILE_SITE_KEY} onToken={handleToken} onReady={handleReady} onError={handleError} />
          </>
        )}
        <button ref={cancelRef} className="hi-gate-cancel" type="button" onClick={handleDismiss}>Cancel vote</button>
      </div>
    </div>
  ) : null;

  return { guardVote, challenge, challengeOpen: waiting };
};
