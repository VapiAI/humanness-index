/**
 * Null-safe PostHog capture for Humanness Index™ engagement events. PostHog is
 * loaded from the global snippet in the root layout; on first paint or when an
 * ad blocker strips it, `window.posthog` is undefined, so we guard every call.
 * Analytics must never break the UX.
 */
import type { VoteChoice } from './types';

const HUMANNESS_EVENT = {
  VOTE: 'humanness_vote_cast',
  ROUND_STARTED: 'humanness_round_started',
  SAMPLE_PLAYED: 'humanness_sample_played',
  DETAIL_LINK_CLICKED: 'humanness_detail_link_clicked',
  CTA_CLICKED: 'humanness_cta_clicked',
} as const;

type HumannessEvent = (typeof HUMANNESS_EVENT)[keyof typeof HUMANNESS_EVENT];

const capture = (event: HumannessEvent, properties: Record<string, unknown>) => {
  if (typeof window === 'undefined') return;
  try {
    window.posthog?.capture(event, properties);
  } catch {
    // Swallow — analytics is best-effort.
  }
};

export const trackVote = (props: {
  winner: VoteChoice;
  leftModelId: string;
  rightModelId: string;
  /** Whether the pick agreed with the crowd consensus. */
  correct: boolean;
}) => capture(HUMANNESS_EVENT.VOTE, props);

export const trackRoundStarted = (props: {
  leftModelId: string;
  rightModelId: string;
}) => capture(HUMANNESS_EVENT.ROUND_STARTED, props);

export const trackSamplePlayed = (modelId: string) =>
  capture(HUMANNESS_EVENT.SAMPLE_PLAYED, { modelId });

/** A link-out from the index page to a model/provider detail page. */
export const trackDetailLinkClicked = (props: {
  kind: 'model' | 'provider';
  slug: string;
}) => capture(HUMANNESS_EVENT.DETAIL_LINK_CLICKED, props);

/** A click on the CTA band ("Run your model" / "Star on GitHub"). */
export const trackCtaClicked = (props: {
  action: 'run-your-model' | 'star-on-github';
  /** Which page hosts the band: 'index' | 'model' | 'provider'. */
  surface: string;
}) => capture(HUMANNESS_EVENT.CTA_CLICKED, props);
