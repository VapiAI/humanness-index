/**
 * Registry schema — the single source of truth for provider/model identity,
 * editorial copy, and sourced facts. Plain TS
 * types validated by catalog.test.ts in `bun test`; intentionally not zod
 * (the registry is code, not untrusted input).
 *
 * Live standings (Elo, W/L/T, vote counts, rank ranges) do NOT live here —
 * they stay in the store behind /api/* with the production export
 * in server/seed-standings.json.
 */

import type { SourceVoiceId } from './voices';

/** A claimed fact with provenance — renderable as a footnoted stat. */
export type Sourced<T> = {
  value: T;
  /**
   * Where the claim was verified: an https URL, or a repo-relative path for
   * internal measurement artifacts (e.g. src/pipeline/results/*).
   */
  sourceUrl: string;
  /** ISO date the source was checked, e.g. '2026-06-10'. */
  asOf: string;
  /** Default 'high'. */
  confidence?: 'high' | 'medium' | 'low';
  /** e.g. 'vendor measures model inference, not E2E TTFA'. */
  note?: string;
};

export type CopyBlock = {
  /** e.g. 'Background', 'Architecture', 'In production'. */
  heading: string;
  /** 1-3 paragraphs. House rule: no em dashes in page copy. */
  paragraphs: string[];
  sourceUrls?: string[];
};

export type FaqEntry = { question: string; answer: string };

/**
 * A pinned hosted clip, addressed by identity (variant, prompt) with its
 * content-hash path under the arena audio origin (see catalog/audio.ts).
 * catalog.test recomputes the hash from the identity and asserts it matches
 * `path`, so these stay derivations of the ids rather than free-floating URLs.
 */
export type FallbackClip = {
  /** `variant:{voiceId}:{providerId}:{arenaApiId}` */
  variantId: string;
  /** Catalog prompt id, e.g. 'clip-07'. */
  promptId: string;
  /** `/audio/{contentHash}.mp3` */
  path: string;
};

/**
 * Language coverage as vendors publish it: a count, a vendor-listed minimum
 * ('70+'), or 'English' for English-only models.
 */
export type LanguageCount = number | `${number}+` | 'English';

export type ProviderEntry = {
  /** Internal id, matches server/catalog.ts ('canopylabs'). Frozen. */
  id: string;
  /** URL segment ('canopy-labs') — frozen after launch. */
  slug: string;
  /** Display name ('Canopy Labs'). */
  name: string;
  websiteUrl: string;
  /** Logomark file under /public/marks (existence tested). */
  mark: string;
  /** Brand text fallback ('11', 'DG') where it differs from plain initials. */
  monogram?: string;
  /**
   * Provider-wide defaults; models may override (see ModelEntry.stats).
   * Latency is intentionally absent here: it is measured per model only
   * (never a vendor estimate), see ModelEntry.stats.latencyMs.
   */
  stats: {
    languages?: Sourced<LanguageCount>;
    /** Display string, e.g. '$15' (per 1M characters; details in note). */
    pricing?: Sourced<string>;
  };
  /** Provider page body (≥2 blocks before a page may be indexed). */
  copy: CopyBlock[];
  faq?: FaqEntry[];
};

/** Offline-fallback sample for the Listen buttons (see FallbackClip). */
export type ModelSample = {
  fallbackClip?: FallbackClip;
};

type ModelEntryBase = {
  /**
   * Internal + API row id, e.g. 'xai-xai-tts'. Frozen: matches
   * server/seed-standings.json and the live store.
   */
  id: string;
  /** URL segment, e.g. 'grok-tts' — frozen after launch. */
  slug: string;
  /** Ref into providers.ts. */
  providerId: string;
  /** Display name ('Grok TTS', 'Sonic 3.5'). */
  name: string;
  /** The vendor's published model id ('eleven_flash_v2_5', 'speech-2.5-turbo-preview'). */
  apiModelId: string;
  /**
   * Arena api id used in variant/audio content hashing — the second
   * segment of server/catalog.ts arenaId ('xai:xai-tts' → 'xai-tts'),
   * inherited from the original prototype's hashing scheme.
   * FROZEN FOREVER: any drift orphans the ~1,700 hosted MP3s.
   */
  arenaApiId: string;
  /** ISO date, 'YYYY-MM', or 'YYYY' when vendors published no finer date. */
  releaseDate?: Sourced<string>;
  /**
   * Marks the Human baseline reference (the four source-voice actors reading
   * the same lines). A baseline anchors the Humanness scale at 100, battles
   * head to head against the cloned TTS of the same voice, and is excluded
   * from the model/provider counts, the highlight cards, and the latency
   * chart. Only the `human` entry sets this; everything else is a competitor.
   */
  baseline?: true;
  /**
   * The source voices this model has clips for, as a subset of the frozen
   * roster (SOURCE_VOICE_IDS). Omit to serve all four (every TTS provider
   * cloned the whole roster). The arena only builds variants and battle
   * pairings for these voices, so a model is never matched on a voice it
   * lacks. The Human baseline sets this and extends it as each voice's
   * recordings are uploaded (one-line edit per voice).
   */
  sourceVoices?: SourceVoiceId[];
  stats: {
    /**
     * Measured-only (hard rule): exact 50-trial streaming TTFB median from
     * the in-repo bench (src/pipeline/ttfbBench.ts), never a vendor
     * estimate. `null` = not measured; the UI shows a dash and excludes the
     * model from latency plots.
     */
    latencyMs: Sourced<number> | null;
    /** Overrides the provider default. */
    languages?: Sourced<LanguageCount>;
    /** Overrides the provider default. Display string, e.g. '$100'. */
    pricing?: Sourced<string>;
    streaming?: Sourced<boolean>;
    /** e.g. 'zero-shot, 10s sample'. */
    voiceCloning?: Sourced<string>;
    /** e.g. 'Apache 2.0'. */
    openSource?: Sourced<string>;
  };
  /** Viz fingerprint seed (unique per model; drives VoiceViz). */
  voiceProfile: number;
  /**
   * Frozen 'likely rank' label paired with the model's row in
   * server/seed-standings.json for the first-paint table. A label, not a
   * recomputation: the export's ranges came from the production field at
   * export time. Required for every listed model with a seed row.
   */
  seedLikelyRank?: string;
  /** Editorial blurb for the featured #1 card (Vapi's take). */
  featuredBlurb?: string;
  /** Model page body (≥2 blocks before a page may be indexed). */
  copy: CopyBlock[];
  faq?: FaqEntry[];
};

/**
 * Lifecycle:
 * - 'active': battles, leaderboard, pages, sitemap.
 * - 'retired': rotated out of the arena; pages stay live (never 404 an
 *   earned URL) but the model leaves battle sampling and the index table.
 * - 'unlisted': excluded from EVERY derived surface. Identity, brand assets,
 *   and seed stats stay wired so re-listing is a one-line status flip
 *   (e.g. a model tested before its public announcement).
 *
 * Discriminated on `status` so the compiler enforces what each stage
 * requires: an ACTIVE model ships on the live page, so it MUST pin an
 * offline fallback clip (forgetting it is a type error, not a test failure).
 * Retired/unlisted entries may keep one wired for re-listing.
 */
export type ModelEntry = ModelEntryBase &
  (
    | { status: 'active'; sample: ModelSample & { fallbackClip: FallbackClip } }
    | { status: 'retired' | 'unlisted'; sample?: ModelSample }
  );

/** An overlay entry must stay off every public surface (see RegistryOverlay). */
export type UnlistedModelEntry = ModelEntry & { status: 'unlisted' };

/**
 * The private registry overlay (SPEC section 4.3): unannounced or embargoed
 * entries the deploy environment injects through the gitignored
 * `catalog/overlay.local.ts`. Constrained to 'unlisted' models at the type
 * level, so every listed/arena surface derives identically whether or not
 * an overlay is present; with the default empty overlay the mechanism is
 * dormant. This is the repo's only private code path.
 */
export type RegistryOverlay = {
  providers: ProviderEntry[];
  models: UnlistedModelEntry[];
};
