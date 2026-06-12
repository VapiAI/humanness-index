'use client';

/**
 * Minimal Cloudflare Turnstile wrapper: loads the script once (explicit
 * render mode), renders the challenge into a div, and surfaces the solved
 * token via `onToken`. Only mounted when NEXT_PUBLIC_TURNSTILE_SITE_KEY is
 * configured (see ../hooks/useVoteGate).
 */
import { useEffect, useRef } from 'react';

type TurnstileRenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
};

type TurnstileApi = {
  render: (element: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<TurnstileApi> | null = null;

const loadTurnstile = (): Promise<TurnstileApi> => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('Turnstile script loaded without its API'));
      };
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('Failed to load the Turnstile script'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
};

type TurnstileWidgetProps = {
  siteKey: string;
  onToken: (token: string) => void;
  /** Fired when the challenge errors, expires, or the script fails to load. */
  onError?: () => void;
};

export const TurnstileWidget = ({
  siteKey,
  onToken,
  onError,
}: TurnstileWidgetProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep latest callbacks without re-rendering the widget.
  const callbacksRef = useRef({ onToken, onError });
  useEffect(() => {
    callbacksRef.current = { onToken, onError };
  });

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;

    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          callback: (token) => callbacksRef.current.onToken(token),
          'expired-callback': () => callbacksRef.current.onError?.(),
          'error-callback': () => callbacksRef.current.onError?.(),
        });
      })
      .catch(() => {
        if (!cancelled) callbacksRef.current.onError?.();
      });

    return () => {
      cancelled = true;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, [siteKey]);

  return <div ref={containerRef} className="hi-gate-widget" />;
};
