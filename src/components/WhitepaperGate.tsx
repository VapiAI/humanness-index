'use client';

/**
 * Email gate for the whitepaper. Every "Read the whitepaper" link opens this
 * modal, which embeds the Vapi HubSpot lead form; once the visitor submits, the
 * gate reveals the PDF. Mirrors the vote gate's modal conventions
 * (see ../hooks/useVoteGate) and the TurnstileWidget's one-time script loader.
 *
 * This is a soft gate: the PDF is a public static asset, so the goal is lead
 * capture, not access control. It also degrades gracefully — with JS disabled
 * the links open the PDF directly (see WhitepaperLink).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { WHITEPAPER_URL } from './shell/SiteNav';
import '../styles/whitepaper-gate.css';

const HUBSPOT_REGION = 'na2';
const HUBSPOT_PORTAL_ID = '244349038';
const HUBSPOT_FORM_ID = '9ae30a99-8519-4bda-b1a9-57503f22e852';
const HUBSPOT_SCRIPT_SRC = `https://js-${HUBSPOT_REGION}.hsforms.net/forms/embed/${HUBSPOT_PORTAL_ID}.js`;

// Load the HubSpot embed script once; it auto-renders every `.hs-form-frame`
// present in the DOM (and observes for new ones).
let hubspotScriptPromise: Promise<void> | null = null;
const loadHubspot = (): Promise<void> => {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!hubspotScriptPromise) {
    hubspotScriptPromise = new Promise<void>((resolve, reject) => {
      if (document.querySelector(`script[src="${HUBSPOT_SCRIPT_SRC}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = HUBSPOT_SCRIPT_SRC;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        hubspotScriptPromise = null;
        reject(new Error('Failed to load the HubSpot form script'));
      };
      document.head.appendChild(script);
    });
  }
  return hubspotScriptPromise;
};

type WhitepaperGateValue = { openWhitepaperGate: () => void };

const WhitepaperGateContext = createContext<WhitepaperGateValue | null>(null);

export const useWhitepaperGate = (): WhitepaperGateValue => {
  const ctx = useContext(WhitepaperGateContext);
  if (!ctx) {
    throw new Error('useWhitepaperGate must be used within <WhitepaperGateProvider>');
  }
  return ctx;
};

export const WhitepaperGateProvider = ({ children }: PropsWithChildren) => {
  const [open, setOpen] = useState(false);
  // The HubSpot iframe is heavy, so only mount it once the gate is first
  // opened, then keep it mounted (hidden when closed) so it renders one time.
  const [mounted, setMounted] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const openWhitepaperGate = useCallback(() => {
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    setMounted(true);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    lastFocusedRef.current?.focus?.();
  }, []);

  // Load the form script on first open.
  useEffect(() => {
    if (!mounted) return;
    loadHubspot().catch(() => setFailed(true));
  }, [mounted]);

  // Move focus into the dialog when it opens.
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  // Escape closes the dialog; lock background scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  // Reveal the PDF once HubSpot reports a successful submission. Depending on
  // the embed version this surfaces as a window CustomEvent or a postMessage,
  // so listen for both.
  useEffect(() => {
    const onSuccess = () => setSubmitted(true);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; eventName?: string } | undefined;
      if (data?.type === 'hsFormCallback' && data.eventName === 'onFormSubmitted') {
        setSubmitted(true);
      }
    };
    window.addEventListener('hs-form-event:on-submission:success', onSuccess);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('hs-form-event:on-submission:success', onSuccess);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  return (
    <WhitepaperGateContext.Provider value={{ openWhitepaperGate }}>
      {children}
      {mounted && (
        <div
          className={`hi-wp-overlay${open ? '' : ' hi-wp-overlay--hidden'}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="hi-wp-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="hi-wp-card">
            <button
              ref={closeRef}
              className="hi-wp-close"
              type="button"
              aria-label="Close"
              onClick={close}
            >
              &times;
            </button>
            <p className="hi-wp-eyebrow">The Humanness Index&trade;</p>
            <h2 className="hi-wp-title" id="hi-wp-title">
              Read the whitepaper
            </h2>

            {submitted ? (
              <div className="hi-wp-done">
                <p className="hi-wp-note">Thanks &mdash; your copy is ready.</p>
                <a
                  className="hi-wp-btn"
                  href={WHITEPAPER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                >
                  Open the whitepaper
                </a>
              </div>
            ) : (
              <>
                <p className="hi-wp-note">
                  Enter your email and we&apos;ll take you straight to the full
                  methodology and results.
                </p>
                <div className="hi-wp-form">
                  <div
                    className="hs-form-frame"
                    data-region={HUBSPOT_REGION}
                    data-form-id={HUBSPOT_FORM_ID}
                    data-portal-id={HUBSPOT_PORTAL_ID}
                  />
                  {failed && (
                    <p className="hi-wp-error">
                      The form didn&apos;t load.{' '}
                      <a href={WHITEPAPER_URL} target="_blank" rel="noopener noreferrer">
                        Open the whitepaper
                      </a>{' '}
                      directly instead.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </WhitepaperGateContext.Provider>
  );
};
