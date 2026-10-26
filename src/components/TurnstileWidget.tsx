'use client';

/**
 * Minimal Cloudflare Turnstile wrapper: loads the script once (explicit
 * render mode), renders the challenge into a div, and surfaces each solved
 * token via `onToken`. Only mounted when NEXT_PUBLIC_TURNSTILE_SITE_KEY is
 * configured (see ../hooks/useVoteGate).
 *
 * Mounted in a visible vote dialog, with Cloudflare's own progress UI shown.
 * Each mount creates a fresh, single-use challenge.
 */
import { useEffect, useRef } from 'react';

type TurnstileRenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: (code: string) => void;
  'timeout-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
  appearance?: 'always' | 'execute' | 'interaction-only';
  'refresh-expired'?: 'auto' | 'manual' | 'never';
};

type TurnstileApi = {
  render: (element: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<TurnstileApi> | null = null;
const SCRIPT_TIMEOUT_MS = 15_000;

const loadTurnstile = (): Promise<TurnstileApi> => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const fail = () => {
        clearTimeout(timeout);
        script.onload = null;
        script.onerror = null;
        script.remove();
        scriptPromise = null;
        reject(new Error('Failed to load the Turnstile script'));
      };
      const timeout = setTimeout(fail, SCRIPT_TIMEOUT_MS);
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => {
        if (!window.turnstile) { fail(); return; }
        clearTimeout(timeout);
        resolve(window.turnstile);
      };
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
};

type TurnstileWidgetProps = {
  siteKey: string;
  onToken: (token: string) => void;
  onReady?: () => void;
  /** No token or secret is included in these diagnostic codes. */
  onError?: (code: string) => void;
};

export const TurnstileWidget = ({
  siteKey,
  onToken,
  onReady,
  onError,
}: TurnstileWidgetProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Keep latest callbacks without re-rendering the widget.
  const callbacksRef = useRef({ onToken, onReady, onError });
  useEffect(() => {
    callbacksRef.current = { onToken, onReady, onError };
  });

  useEffect(() => {
    let cancelled = false;

    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          appearance: 'always',
          'refresh-expired': 'auto',
          callback: (token) => { if (!cancelled) callbacksRef.current.onToken(token); },
          'expired-callback': () => { if (!cancelled) callbacksRef.current.onError?.('expired'); },
          'timeout-callback': () => { if (!cancelled) callbacksRef.current.onError?.('timeout'); },
          'error-callback': (code) => {
            if (!cancelled) callbacksRef.current.onError?.(code);
          },
        });
        callbacksRef.current.onReady?.();
      })
      .catch(() => {
        if (!cancelled) callbacksRef.current.onError?.('script-load');
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  return <div ref={containerRef} className="hi-gate-widget" />;
};
