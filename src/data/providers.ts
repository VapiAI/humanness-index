/**
 * Display-stat helpers over the registry (../catalog), which owns every
 * provider/model fact with provenance attached. This module just formats:
 * the regex-on-display-name overrides that used to live here are gone —
 * every model carries explicit values now.
 */
import {
  arenaProviderEntryByName,
  type LanguageCount,
  modelEntryByDisplayName,
  modelEntryById,
  PROVIDER_ENTRIES,
  type Sourced,
} from '../catalog';
import { STAT_DASH as DASH } from '../lib/detail';
import type { ArenaRow } from '../lib/types';

type VoiceStats = {
  latency: string;
  langs: string;
  price: string;
};

const formatLangs = (languages: Sourced<LanguageCount> | undefined): string =>
  languages ? String(languages.value) : DASH;

/**
 * Stats for an arena row, keyed by its display names. Latency is
 * measured-only (50-trial streaming TTFB medians in the registry; see
 * catalog/models.ts for methodology): models without a measurement show a
 * dash, never a vendor estimate. Languages/price read the model's explicit
 * stats, falling back to its provider's defaults; rows the registry doesn't
 * list (including 'unlisted' entries) render as dashes.
 */
export const voiceStats = (
  model: Pick<ArenaRow, 'provider' | 'model'>,
): VoiceStats => {
  const entry = modelEntryByDisplayName(model.provider, model.model);
  const provider = arenaProviderEntryByName(model.provider);
  const latencyMs = entry?.stats.latencyMs ?? null;
  return {
    latency: latencyMs ? `${latencyMs.value} ms` : DASH,
    langs: formatLangs(entry?.stats.languages ?? provider?.stats.languages),
    price: (entry?.stats.pricing ?? provider?.stats.pricing)?.value ?? DASH,
  };
};

/** Bare logomark files under /public/marks, keyed by provider. */
export const PROVIDER_MARKS: Record<string, string> = Object.fromEntries(
  PROVIDER_ENTRIES.map((provider) => [provider.name, provider.mark]),
);

const providerInitials = (provider: string) =>
  provider
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Monogram where the brand mark differs from plain initials, else initials. */
export const brandLogoText = (provider: string) =>
  PROVIDER_ENTRIES.find((entry) => entry.name === provider)?.monogram ??
  providerInitials(provider);

/** Vapi's editorial take on the current leader (shown on the featured #1 card). */
export const modelBlurb = (
  model: Pick<ArenaRow, 'id' | 'provider' | 'model'>,
) =>
  modelEntryById(model.id)?.featuredBlurb ??
  `${model.provider} ${model.model} currently leads the Humanness Index™. Across blind listening tests it's judged the most human-sounding voice in the field, the kind of delivery that holds up with real callers in production, not just in a demo.`;
