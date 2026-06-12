/**
 * Shape of the PostHog snippet loaded (env-gated) by app/layout.tsx.
 * lib/analytics.ts null-checks every access, so the property is optional:
 * without NEXT_PUBLIC_POSTHOG_KEY the snippet never loads and capture
 * silently no-ops.
 */
export interface PostHog {
  capture: (
    eventName: string,
    properties?: Record<string, unknown>,
  ) => void;
}

declare global {
  interface Window {
    posthog?: PostHog;
  }
}
