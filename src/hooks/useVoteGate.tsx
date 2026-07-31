'use client';

/**
 * Turnstile vote gate: every vote carries a freshly solved Cloudflare token,
 * which the server requires whenever TURNSTILE_SECRET_KEY is set (see
 * ../server/turnstile.ts). Charging every vote is what makes scripted voting
 * expensive — the old every-10th cadence let a script simply omit the field.
 *
 * The widget stays mounted and solves in the background, so one token is
 * always warm: a vote spends it and asks for the next, and the listener sees
 * nothing. Only a vote that arrives before its token does has to wait, and
 * that wait is the sole time the gate is on screen.
 *
 * Gracefully no-ops when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset: votes pass
 * straight through, matching how the repo's other integrations degrade
 * without keys.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { TurnstileWidget } from '../components/TurnstileWidget';
import '../styles/vote-gate.css';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

type PendingVote = {
  cast: (captchaToken?: string) => void;
  cancel?: () => void;
};

type VoteGate = {
  /**
   * Spend the warm token on `castVote`, or hold the vote until one lands.
   * Abandoning a held vote fires the optional `onCancel` so the caller can
   * release any in-flight lock.
   */
  guardVote: (
    castVote: (captchaToken?: string) => void,
    onCancel?: () => void,
  ) => void;
  /** The gate; render it once near the page root. */
  challenge: ReactNode;
  /** True while a vote waits on the challenge (page shortcuts stand down). */
  challengeOpen: boolean;
};

export const useVoteGate = (): VoteGate => {
  const tokenRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingVote | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  // Bumped whenever a token is spent or abandoned, so the widget mints the next.
  const [resetSignal, setResetSignal] = useState(0);

  const requestToken = useCallback(() => {
    tokenRef.current = null;
    setResetSignal((count) => count + 1);
  }, []);

  const guardVote = useCallback<VoteGate['guardVote']>(
    (castVote, onCancel) => {
      if (!TURNSTILE_SITE_KEY) {
        castVote();
        return;
      }
      const token = tokenRef.current;
      if (token !== null) {
        requestToken();
        castVote(token);
        return;
      }
      pendingRef.current = { cast: castVote, cancel: onCancel };
      setFailed(false);
      setWaiting(true);
    },
    [requestToken],
  );

  const handleToken = useCallback(
    (token: string) => {
      setFailed(false);
      const pending = pendingRef.current;
      if (!pending) {
        tokenRef.current = token;
        return;
      }
      pendingRef.current = null;
      setWaiting(false);
      requestToken();
      pending.cast(token);
    },
    [requestToken],
  );

  // The challenge expired, errored, or the script never loaded. Release the
  // held vote so the page unlocks, but keep the gate up carrying the error —
  // without a token the vote cannot count, so silently dropping it would look
  // like the arena had broken.
  const handleError = useCallback(() => {
    tokenRef.current = null;
    setFailed(true);
    const pending = pendingRef.current;
    pendingRef.current = null;
    pending?.cancel?.();
  }, []);

  const handleDismiss = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setWaiting(false);
    setFailed(false);
    requestToken();
    pending?.cancel?.();
  }, [requestToken]);

  useEffect(() => {
    if (!waiting) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleDismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [waiting, handleDismiss]);

  // Mounted for the whole session to keep a token warm; `data-waiting` is what
  // turns it into a visible modal. It is never unmounted — Turnstile needs a
  // laid-out element to solve into, so the idle state is transparent rather
  // than hidden.
  const challenge = TURNSTILE_SITE_KEY ? (
    <div
      className="hi-gate-overlay"
      data-waiting={waiting ? 'true' : 'false'}
      role={waiting ? 'dialog' : undefined}
      aria-modal={waiting ? 'true' : undefined}
      aria-hidden={waiting ? undefined : 'true'}
      aria-label="Confirm you're human"
    >
      <div className="hi-gate-card">
        <h2 className="hi-gate-title">Quick human check</h2>
        <p className="hi-gate-note">
          One short check keeps the rankings honest. It usually clears itself —
          your vote goes through the moment it does.
        </p>
        <TurnstileWidget
          siteKey={TURNSTILE_SITE_KEY}
          onToken={handleToken}
          onError={handleError}
          resetSignal={resetSignal}
        />
        {failed && (
          <p className="hi-gate-error">
            The check didn&apos;t load or expired. Close this and try voting
            again.
          </p>
        )}
        <button
          className="hi-gate-cancel"
          type="button"
          onClick={handleDismiss}
          tabIndex={waiting ? undefined : -1}
        >
          Cancel vote
        </button>
      </div>
    </div>
  ) : null;

  return { guardVote, challenge, challengeOpen: waiting };
};
