/**
 * Shared derivations for the detail pages (/providers/[slug],
 * /models/[slug]): registry slug lookups, SEO title and
 * description patterns, sourced-stat rows with footnotes, JSON-LD payloads,
 * and standings math over the server snapshot.
 *
 * Routing constants live here and ONLY here (the path prefix changed when
 * the Index moved from vapi.ai/humanness-index to its own domain; the slug
 * VALUES are frozen forever).
 *
 * Client-safe on purpose (pure data + pure functions, no node builtins): the
 * live-refresh islands share the same formatting as the RSC shell. House
 * rule: no em dashes in any copy string in this module.
 */
import {
  listedModelEntries,
  listedProviderEntries,
  providerOfModel,
  type CopyBlock,
  type ModelEntry,
  type ProviderEntry,
  type Sourced,
} from '../catalog';
import { ARENA_ROWS, mergeStandings } from '../data/models';
import type { ArenaModelRow } from './api';
import { competitorRank, humannessScore, sortByStanding } from './scoring';
import type { ArenaRow } from './types';

const SITE_ORIGIN = 'https://humannessindex.vapi.ai';
export const INDEX_PATH = '/';

/** Canonical absolute URL for a site path (JSON-LD, og:url). */
export const absoluteUrl = (path: string): string =>
  path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;

/* --------------------------------- Routing -------------------------------- */

export const modelPath = (entry: Pick<ModelEntry, 'slug'>) =>
  `/models/${entry.slug}`;

export const providerPath = (entry: Pick<ProviderEntry, 'slug'>) =>
  `/providers/${entry.slug}`;

/** Listed-only lookups: unlisted slugs resolve to nothing and 404. */
export const listedModelEntryBySlug = (slug: string): ModelEntry | undefined =>
  listedModelEntries().find((entry) => entry.slug === slug);

export const listedProviderEntryBySlug = (
  slug: string,
): ProviderEntry | undefined =>
  listedProviderEntries().find((entry) => entry.slug === slug);

/** Listed models of one provider, in frozen registry order. */
export const listedModelEntriesOfProvider = (
  providerId: string,
): ModelEntry[] =>
  listedModelEntries().filter((entry) => entry.providerId === providerId);

/* ----------------------------- Index link-out ------------------------------
 * The index page's cards, table, and battle reveal link out to the detail
 * pages through these lookups, keyed by what an arena row actually carries
 * (model id, provider display name). Rows without a listed entry (unknown to
 * the registry, or unlisted pre-announcement) resolve to null and
 * render as plain text, never as links.
 * -------------------------------------------------------------------------- */

export type DetailLink = { path: string; slug: string };

const MODEL_LINKS_BY_ID = new Map<string, DetailLink>(
  listedModelEntries().map((entry) => [
    entry.id,
    { path: modelPath(entry), slug: entry.slug },
  ]),
);

const PROVIDER_LINKS_BY_NAME = new Map<string, DetailLink>(
  listedProviderEntries().map((entry) => [
    entry.name,
    { path: providerPath(entry), slug: entry.slug },
  ]),
);

export const modelDetailLinkForId = (modelId: string): DetailLink | null =>
  MODEL_LINKS_BY_ID.get(modelId) ?? null;

export const providerDetailLinkForName = (
  providerName: string,
): DetailLink | null => PROVIDER_LINKS_BY_NAME.get(providerName) ?? null;

/* ----------------------------- SEO patterns ------------------------------- */

/** "Sonic 3.5 TTS" but "Grok TTS" stays as-is (no "TTS TTS"). */
const modelNameWithKind = (entry: ModelEntry) =>
  /tts/i.test(entry.name) ? entry.name : `${entry.name} TTS`;

export const modelPageTitle = (
  entry: ModelEntry,
  provider: ProviderEntry,
): string => {
  const retired = entry.status === 'retired' ? ' (retired)' : '';
  return `${provider.name} ${modelNameWithKind(entry)}${retired}: Humanness Score, Latency & Samples | Vapi`;
};

export const modelPageDescription = (
  entry: ModelEntry,
  provider: ProviderEntry,
): string =>
  `How human does ${provider.name} ${entry.name} sound? Blind-test Humanness score, measured latency, languages, pricing, and audio samples on the Humanness Index™ by Vapi.`;

export const providerPageTitle = (entry: ProviderEntry): string =>
  `${entry.name} Text to Speech Models: Humanness Rankings | Vapi`;

export const providerPageDescription = (
  entry: ProviderEntry,
  modelCount: number,
): string =>
  `${entry.name} text to speech on the Humanness Index™ by Vapi: ${modelCount} ${
    modelCount === 1 ? 'model' : 'models'
  } ranked by blind listener votes, with Humanness scores, measured latency, languages, and pricing.`;

/**
 * One-line positioning for the hero, lifted from the entry's first copy
 * paragraph. Registry copy never puts a space after a mid-token period
 * ("v2.5", "Speech 2.5"), so the ". " split is safe.
 */
export const positioningLine = (copy: CopyBlock[]): string => {
  const paragraph = copy[0]?.paragraphs[0] ?? '';
  const sentence = paragraph.split('. ')[0] ?? '';
  if (!sentence) return '';
  return sentence.endsWith('.') ? sentence : `${sentence}.`;
};

/* ------------------------------- Formatting ------------------------------- */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTHS_SHORT = MONTHS.map((month) => month.slice(0, 3));

/** '2026-05-04' -> 'May 4, 2026'; '2024-05' -> 'May 2024'; '2023' -> '2023'. */
export const formatReleaseDate = (value: string): string => {
  const [year, month, day] = value.split('-');
  if (!month) return year;
  const monthName = MONTHS[Number(month) - 1] ?? month;
  return day ? `${monthName} ${Number(day)}, ${year}` : `${monthName} ${year}`;
};

/**
 * Deterministic UTC stamp for the "standings as of" label, so the server
 * snapshot and first client render agree byte-for-byte.
 */
export const formatAsOfUtc = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const month = MONTHS_SHORT[date.getUTCMonth()];
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${hours}:${minutes} UTC`;
};

/* ------------------------------- Standings -------------------------------- */

/** Wire rows -> presentation rows (likely rank + viz seed), best first. */
export const sortedRowsFrom = (models: ArenaModelRow[]): ArenaRow[] =>
  sortByStanding(mergeStandings(models));

export type ModelStanding = {
  row: ArenaRow;
  rank: number;
  score: number;
  votes: number;
};

export const standingForModel = (
  rows: ArenaRow[],
  modelId: string,
): ModelStanding | null => {
  const row = rows.find((candidate) => candidate.id === modelId);
  if (!row) return null;
  return {
    row,
    // Ranked among competitors, ignoring the Human baseline (0 for the
    // baseline itself, which has no competitive rank).
    rank: competitorRank(modelId, rows),
    score: humannessScore(row, rows),
    votes: row.wins + row.losses + row.ties,
  };
};

/** A provider's best-placed row (rows arrive sorted best-first). */
export const bestStandingForProvider = (
  rows: ArenaRow[],
  providerName: string,
): ModelStanding | null => {
  const row = rows.find((candidate) => candidate.provider === providerName);
  return row ? standingForModel(rows, row.id) : null;
};

/** The model's row with up to two neighbors on each side, global ranks kept. */
export const standingsExcerptFor = (
  rows: ArenaRow[],
  modelId: string,
): { row: ArenaRow; rank: number }[] => {
  const index = rows.findIndex((row) => row.id === modelId);
  if (index === -1) return [];
  const start = Math.max(0, index - 2);
  return rows
    .slice(start, Math.min(rows.length, index + 3))
    // Competitor rank ignores the Human baseline so neighbor ranks read the
    // same here as on the index (baseline rows resolve to 0).
    .map((row) => ({ row, rank: competitorRank(row.id, rows) }));
};

/* ------------------------------ Sourced stats ------------------------------ */

/** The shared "value absent" marker for stat displays (never a guess). */
export const STAT_DASH = '\u2014';

export type StatFootnote = {
  marker: number;
  sourceUrl: string;
  asOf: string;
  note?: string;
  confidence?: 'high' | 'medium' | 'low';
};

export type StatRowView = {
  label: string;
  value: string;
  /** Footnote marker into the block's sources list. */
  marker?: number;
  /** Inline annotation for unsourced/absent values (no footnote). */
  note?: string;
};

export type StatsView = {
  rows: StatRowView[];
  footnotes: StatFootnote[];
};

const NOT_MEASURED_NOTE =
  'Not measured: no publicly reachable API at benchmark time. The Index never shows vendor latency estimates.';

type StatInput = {
  label: string;
  sourced: Sourced<unknown> | null | undefined;
  format?: (value: never) => string;
  /** Renders the row with a dash + note instead of dropping it. */
  absentNote?: string;
};

const buildStats = (inputs: StatInput[]): StatsView => {
  const rows: StatRowView[] = [];
  const footnotes: StatFootnote[] = [];
  const markerBySource = new Map<string, number>();

  for (const input of inputs) {
    if (!input.sourced) {
      if (input.absentNote) {
        rows.push({
          label: input.label,
          value: STAT_DASH,
          note: input.absentNote,
        });
      }
      continue;
    }
    const { sourceUrl, asOf, note, confidence } = input.sourced;
    const dedupeKey = `${sourceUrl}\u0000${note ?? ''}`;
    let marker = markerBySource.get(dedupeKey);
    if (marker === undefined) {
      marker = footnotes.length + 1;
      markerBySource.set(dedupeKey, marker);
      footnotes.push({ marker, sourceUrl, asOf, note, confidence });
    }
    const format = input.format as ((value: unknown) => string) | undefined;
    rows.push({
      label: input.label,
      value: format ? format(input.sourced.value) : String(input.sourced.value),
      marker,
    });
  }

  return { rows, footnotes };
};

/**
 * Model stats block: measured latency (dash + note when null, hard rule),
 * languages and price falling back to provider defaults, plus the optional
 * sourced extras. Unsourced fields render as absent, never as guesses.
 */
export const modelStatsView = (
  entry: ModelEntry,
  provider: ProviderEntry,
): StatsView =>
  buildStats([
    {
      label: 'Latency (measured)',
      sourced: entry.stats.latencyMs,
      format: (value: number) => `${value} ms`,
      absentNote: NOT_MEASURED_NOTE,
    },
    {
      label: 'Languages',
      sourced: entry.stats.languages ?? provider.stats.languages,
    },
    {
      label: 'Price / 1M chars',
      sourced: entry.stats.pricing ?? provider.stats.pricing,
    },
    {
      label: 'Streaming',
      sourced: entry.stats.streaming,
      format: (value: boolean) => (value ? 'Yes' : 'No'),
    },
    { label: 'Voice cloning', sourced: entry.stats.voiceCloning },
    { label: 'Open source', sourced: entry.stats.openSource },
    {
      label: 'Released',
      sourced: entry.releaseDate,
      format: formatReleaseDate,
    },
  ]);

/** Provider stats block: provider-wide defaults only. */
export const providerStatsView = (entry: ProviderEntry): StatsView =>
  buildStats([
    { label: 'Languages', sourced: entry.stats.languages },
    {
      label: 'Price / 1M chars',
      sourced: entry.stats.pricing,
      absentNote: 'No published pricing to cite yet.',
    },
  ]);

/** Quick per-row stat strings for tables/cards (entry-first, provider fallback). */
export const modelQuickStats = (
  entry: ModelEntry,
  provider: ProviderEntry,
) => ({
  latency: entry.stats.latencyMs
    ? `${entry.stats.latencyMs.value} ms`
    : STAT_DASH,
  languages: String(
    (entry.stats.languages ?? provider.stats.languages)?.value ?? STAT_DASH,
  ),
  price: (entry.stats.pricing ?? provider.stats.pricing)?.value ?? STAT_DASH,
});

/* --------------------------------- JSON-LD -------------------------------- */

export type BreadcrumbItem = { name: string; path?: string };

export const breadcrumbsJsonLd = (items: BreadcrumbItem[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    ...(item.path ? { item: absoluteUrl(item.path) } : {}),
  })),
});

/**
 * SoftwareApplication for model pages:
 * honest fit for a commercial TTS model/API. No aggregateRating by policy.
 * `offers` only when pricing is sourced and an actual dollar rate.
 */
export const modelJsonLd = (entry: ModelEntry, provider: ProviderEntry) => {
  const pricing = entry.stats.pricing ?? provider.stats.pricing;
  const offers =
    pricing && pricing.value.startsWith('$')
      ? {
          offers: {
            '@type': 'Offer',
            url: pricing.sourceUrl,
            priceCurrency: 'USD',
          },
        }
      : {};
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: entry.name,
    alternateName: `${provider.name} ${entry.name}`,
    applicationCategory: 'Text-to-speech model',
    operatingSystem: 'Cloud API',
    url: absoluteUrl(modelPath(entry)),
    description: modelPageDescription(entry, provider),
    provider: {
      '@type': 'Organization',
      name: provider.name,
      url: provider.websiteUrl,
    },
    ...offers,
    isPartOf: { '@type': 'WebPage', '@id': absoluteUrl(INDEX_PATH) },
  };
};

export const providerJsonLd = (entry: ProviderEntry) => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: entry.name,
  url: entry.websiteUrl,
  logo: absoluteUrl(`/marks/${entry.mark}`),
});

/**
 * The Index page's ranked model list as an ItemList of model page URLs, the
 * hub-to-detail signal. Listed models in seed
 * order (the production standings export, best first); listed entries without
 * a seed row (possible for future additions) append in registry order.
 */
export const indexModelsItemListJsonLd = () => {
  const listedById = new Map(
    listedModelEntries().map((entry) => [entry.id, entry]),
  );
  const seedIds = new Set(ARENA_ROWS.map((row) => row.id));
  const ordered = [
    ...ARENA_ROWS.flatMap((row) => listedById.get(row.id) ?? []),
    ...listedModelEntries().filter((entry) => !seedIds.has(entry.id)),
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Text to speech models on the Humanness Index™',
    itemListElement: ordered.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: `${providerOfModel(entry).name} ${entry.name}`,
      url: absoluteUrl(modelPath(entry)),
    })),
  };
};

/** The provider page's models table as an ItemList of model page URLs. */
export const providerModelsItemListJsonLd = (
  provider: ProviderEntry,
  models: ModelEntry[],
) => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: `${provider.name} models on the Humanness Index™`,
  itemListElement: models.map((model, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: `${provider.name} ${model.name}`,
    url: absoluteUrl(modelPath(model)),
  })),
});

/* --------------------------------- Misc ----------------------------------- */

/** Re-exported so detail components avoid importing the registry directly. */
export { providerOfModel };
