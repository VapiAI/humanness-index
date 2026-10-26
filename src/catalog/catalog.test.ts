/// <reference types="bun" />
/**
 * Registry validation (build-time guarantees: runs in `bun test`, which CI
 * runs on every PR) + derivation-equality goldens.
 *
 * The goldens freeze the pre-registry values of every derived surface:
 * server catalog identity (MODELS/VARIANTS — the audio content hashes
 * depend on them), the first-paint ARENA_ROWS, and the display-stat
 * helpers. If a registry edit shifts any of them, that is a regression, not
 * a snapshot to update — except the pinned counts, which are meant to be
 * bumped intentionally when adding a model.
 *
 * Overlay awareness: the suite must pass with ANY overlay state (the empty
 * default in CI, or a deploy overlay carrying unlisted entries), so count
 * pins target the committed base registry and unlisted-exclusion checks
 * iterate whatever the overlay carries.
 */
import { describe, expect, it } from 'bun:test';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ARENA_AUDIO_ORIGIN,
  arenaModelEntries,
  arenaProviderEntries,
  type CopyBlock,
  type FaqEntry,
  listedModelEntries,
  listedProviderEntries,
  MODEL_ENTRIES,
  type ModelEntry,
  modelEntryByDisplayName,
  modelEntryById,
  PROVIDER_ENTRIES,
  type ProviderEntry,
  providerEntryById,
  type Sourced,
} from '.';
import { MODEL_ENTRIES as BASE_MODEL_ENTRIES } from './models';
import { OVERLAY } from './overlay.local';
import { PROVIDER_ENTRIES as BASE_PROVIDER_ENTRIES } from './providers';
import {
  FALLBACK_BATTLE_SPECS,
  HERO_BATTLES,
  MODEL_SAMPLE_CLIPS,
} from '../data/battles';
import {
  ARENA_ROWS,
  mergeStandings,
  SEED_TOTAL_UNIQUE_VOTES,
} from '../data/models';
import { SEED_STANDINGS } from '../data/seedStandings';
import {
  brandLogoText,
  modelBlurb,
  PROVIDER_MARKS,
  voiceStats,
} from '../data/providers';
import { parseLatencyMs } from '../lib/scoring';
import {
  audioUrlFor,
  MODELS,
  MODELS_BY_ID,
  PROMPTS_BY_ID,
  PROVIDERS_BY_ID,
  VARIANTS,
  variantsOfModel,
} from '../server/catalog';

const EM_DASH = '\u2014';
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const RANK_RANGE_PATTERN = /^#\d+(-\d+)?$/;
/** ISO date ('2026-06-10'), 'YYYY-MM', or 'YYYY' for coarse vendor dates. */
const DATE_PATTERN = /^\d{4}(-\d{2}){0,2}$/;
/**
 * Internal measurement artifacts are sourced by repo path, not URL;
 * `team-reported/<date>` marks a first-party measurement without an
 * in-repo artifact (still never a vendor estimate).
 */
const BENCHMARK_PATH_PATTERN = /^(src\/pipeline\/results|team-reported)\//;

const MARKS_DIR = resolve(import.meta.dir, '../../public/marks');

/* ------------------------------ Registry shape ----------------------------- */

describe('registry: ids, slugs, refs', () => {
  it('pins the collection counts (bump intentionally when adding entries)', () => {
    // 12 providers / 25 models: the 11 vendors + 24 TTS models, plus the Human
    // baseline (provider `human`, model `human`). Two ElevenLabs entries are
    // retired (2026-07-23) and Sonic 3.6 is unlisted pending its clips, so the
    // arena carries 22 of the 25.
    expect(BASE_PROVIDER_ENTRIES.length).toBe(12);
    expect(BASE_MODEL_ENTRIES.length).toBe(25);
    expect(arenaProviderEntries().length).toBe(12);
    expect(arenaModelEntries().length).toBe(22);
    // Sonic 3.6 is committed but unlisted until its clips are generated;
    // flipping status to 'active' is the one-line re-list.
    expect(
      BASE_MODEL_ENTRIES.filter((m) => m.status === 'unlisted').map((m) => m.id),
    ).toEqual(['cartesia-sonic-36']);
  });

  it('constrains the overlay to unlisted models with resolvable providers', () => {
    // Type-enforced too (RegistryOverlay), but the suite must hold for any
    // overlay the deploy injects: nothing in an overlay may reach a public
    // surface, and its refs must resolve within the merged registry.
    for (const model of OVERLAY.models) {
      expect(model.status).toBe('unlisted');
      expect(providerEntryById(model.providerId)).toBeDefined();
    }
    for (const provider of OVERLAY.providers) {
      expect(
        BASE_PROVIDER_ENTRIES.some((base) => base.id === provider.id),
      ).toBe(false);
    }
  });

  it('keeps ids and slugs unique and well-formed', () => {
    const providerIds = PROVIDER_ENTRIES.map((p) => p.id);
    const providerSlugs = PROVIDER_ENTRIES.map((p) => p.slug);
    const modelIds = MODEL_ENTRIES.map((m) => m.id);
    const modelSlugs = MODEL_ENTRIES.map((m) => m.slug);
    expect(new Set(providerIds).size).toBe(providerIds.length);
    expect(new Set(providerSlugs).size).toBe(providerSlugs.length);
    expect(new Set(modelIds).size).toBe(modelIds.length);
    expect(new Set(modelSlugs).size).toBe(modelSlugs.length);
    for (const slug of [...providerSlugs, ...modelSlugs]) {
      expect(slug).toMatch(SLUG_PATTERN);
    }
  });

  it('keeps provider and model slugs from colliding with each other', () => {
    const providerSlugs = new Set(PROVIDER_ENTRIES.map((p) => p.slug));
    for (const model of MODEL_ENTRIES) {
      expect(providerSlugs.has(model.slug)).toBe(false);
    }
  });

  it('resolves every model→provider ref and gives every provider ≥1 model', () => {
    for (const model of MODEL_ENTRIES) {
      expect(providerEntryById(model.providerId)).toBeDefined();
    }
    for (const provider of PROVIDER_ENTRIES) {
      expect(
        MODEL_ENTRIES.filter((m) => m.providerId === provider.id).length,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps voiceProfile seeds unique and positive across all entries', () => {
    const profiles = MODEL_ENTRIES.map((m) => m.voiceProfile);
    expect(new Set(profiles).size).toBe(profiles.length);
    for (const profile of profiles) {
      expect(profile).toBeGreaterThan(0);
      expect(Number.isInteger(profile)).toBe(true);
    }
  });

  it('matches seed-standings.json one-to-one (update intentionally for unseeded adds)', () => {
    // June 2026 additions with no production export rows: they start at
    // Elo 1200 on first live votes and join the table on first fetch.
    const UNSEEDED_MODEL_IDS = new Set([
      'elevenlabs-multilingual-v2',
      'minimax-speech-02-hd',
      'minimax-speech-02-turbo',
      'smallestai-lightning-v31',
      'neuphonic-neu-hq',
      'speechify-simba-3-2',
      'fish-s21-pro',
      'cartesia-sonic-36',
    ]);
    const seedIds = SEED_STANDINGS.models.map((row) => row.id);
    expect(new Set(seedIds).size).toBe(seedIds.length);
    // Every seed row resolves to a committed registry entry.
    for (const id of seedIds) {
      expect(BASE_MODEL_ENTRIES.some((model) => model.id === id)).toBe(true);
    }
    // Every committed entry is either seeded or pinned as an unseeded add.
    // (Overlay entries are exempt: their seed rows are withheld with them.)
    const seedIdSet = new Set(seedIds);
    for (const model of BASE_MODEL_ENTRIES) {
      expect(seedIdSet.has(model.id) || UNSEEDED_MODEL_IDS.has(model.id)).toBe(
        true,
      );
      expect(seedIdSet.has(model.id) && UNSEEDED_MODEL_IDS.has(model.id)).toBe(
        false,
      );
    }
    // Every listed model with a seed row carries its frozen first-paint label;
    // unseeded models must not fake one. The Human baseline is seeded (its
    // anchor Elo) but has no competitive rank, so it is exempt.
    for (const model of MODEL_ENTRIES) {
      if (
        model.status !== 'unlisted' &&
        seedIdSet.has(model.id) &&
        !model.baseline
      ) {
        expect(model.seedLikelyRank).toBeDefined();
      }
      if (UNSEEDED_MODEL_IDS.has(model.id)) {
        expect(model.seedLikelyRank).toBeUndefined();
      }
      if (model.seedLikelyRank) {
        expect(model.seedLikelyRank).toMatch(RANK_RANGE_PATTERN);
      }
    }
  });

  it('points every provider mark at a real file', () => {
    for (const provider of PROVIDER_ENTRIES) {
      expect(existsSync(resolve(MARKS_DIR, provider.mark))).toBe(true);
    }
  });
});

/* ------------------------------ Sourced facts ------------------------------ */

const sourcedFieldsOf = (
  entry: ProviderEntry | ModelEntry,
): Array<[string, Sourced<unknown>]> => {
  const fields: Array<[string, Sourced<unknown>]> = [];
  if ('releaseDate' in entry && entry.releaseDate) {
    fields.push(['releaseDate', entry.releaseDate]);
  }
  const stats = Object.entries(entry.stats) as Array<
    [string, Sourced<unknown> | null | undefined]
  >;
  for (const [key, value] of stats) {
    if (value) fields.push([key, value]);
  }
  return fields;
};

describe('registry: sourced stats', () => {
  it('gives every Sourced fact a source and a parseable asOf date', () => {
    const entries = [...PROVIDER_ENTRIES, ...MODEL_ENTRIES];
    for (const entry of entries) {
      // The Bun 1.0.3 runner predates expect's custom-message arg; failures
      // here identify the entry/field via this assertion pattern instead.
      for (const [field, sourced] of sourcedFieldsOf(entry)) {
        const validSource =
          /^https?:\/\/.+/.test(sourced.sourceUrl) ||
          BENCHMARK_PATH_PATTERN.test(sourced.sourceUrl);
        expect([entry.id, field, validSource]).toEqual([entry.id, field, true]);
        expect(sourced.asOf).toMatch(DATE_PATTERN);
        expect(Number.isNaN(Date.parse(sourced.asOf))).toBe(false);
        expect(sourced.value === '' || sourced.value === null).toBe(false);
      }
    }
  });

  it('keeps latency measured-only: a benchmark-sourced number or null', () => {
    for (const model of MODEL_ENTRIES) {
      const latency = model.stats.latencyMs;
      if (latency === null) continue;
      expect(typeof latency.value).toBe('number');
      expect(latency.value).toBeGreaterThan(0);
      // Never a vendor estimate: provenance must be the benchmark artifact.
      expect(latency.sourceUrl).toMatch(BENCHMARK_PATH_PATTERN);
    }
  });

  it('formats releaseDate values as YYYY[-MM[-DD]]', () => {
    for (const model of MODEL_ENTRIES) {
      if (model.releaseDate) {
        expect(model.releaseDate.value).toMatch(DATE_PATTERN);
      }
    }
  });
});

/* ------------------------------- Copy rules -------------------------------- */

const entryStrings = (entry: {
  copy: CopyBlock[];
  faq?: FaqEntry[];
  featuredBlurb?: string;
}): string[] => [
  ...entry.copy.flatMap((block) => [block.heading, ...block.paragraphs]),
  ...(entry.faq ?? []).flatMap((faq) => [faq.question, faq.answer]),
  ...(entry.featuredBlurb ? [entry.featuredBlurb] : []),
];

describe('registry: copy', () => {
  it('contains no em dashes and no empty paragraphs (house rules)', () => {
    for (const entry of [...PROVIDER_ENTRIES, ...MODEL_ENTRIES]) {
      for (const text of entryStrings(entry)) {
        expect(text.includes(EM_DASH)).toBe(false);
      }
      for (const block of entry.copy) {
        expect(block.paragraphs.length).toBeGreaterThan(0);
        for (const paragraph of block.paragraphs) {
          expect(paragraph.trim().length).toBeGreaterThan(0);
        }
        for (const url of block.sourceUrls ?? []) {
          expect(url).toMatch(/^https?:\/\/.+/);
        }
      }
    }
  });

  it('meets the thin-content gate: ≥2 copy blocks on active entries', () => {
    for (const model of arenaModelEntries()) {
      expect(model.copy.length).toBeGreaterThanOrEqual(2);
      expect((model.faq ?? []).length).toBeGreaterThanOrEqual(2);
    }
    for (const provider of arenaProviderEntries()) {
      expect(provider.copy.length).toBeGreaterThanOrEqual(2);
    }
  });
});

/* ----------------------- Derivation equality (goldens) --------------------- */

/**
 * The exact pre-registry server catalog identity. arenaId order and content
 * feed the variant ids and audio content hashes — any drift orphans the
 * ~1,700 hosted MP3s.
 */
const EXPECTED_MODELS = [
  {
    id: 'elevenlabs-turbo-v2',
    arenaId: 'elevenlabs:eleven_turbo_v2',
    providerId: 'elevenlabs',
    name: 'Turbo v2',
  },
  // elevenlabs-turbo-v25 and elevenlabs-multilingual-v2 retired 2026-07-23:
  // out of the arena catalog, pages stay live.
  {
    id: 'elevenlabs-flash-v2',
    arenaId: 'elevenlabs:eleven_flash_v2',
    providerId: 'elevenlabs',
    name: 'Flash v2',
  },
  {
    id: 'elevenlabs-flash-v25',
    arenaId: 'elevenlabs:eleven_flash_v2_5',
    providerId: 'elevenlabs',
    name: 'Flash v2.5',
  },
  {
    id: 'elevenlabs-eleven-v3',
    arenaId: 'elevenlabs:eleven_v3',
    providerId: 'elevenlabs',
    name: 'Eleven v3',
  },
  {
    id: 'cartesia-sonic',
    arenaId: 'cartesia:sonic',
    providerId: 'cartesia',
    name: 'Sonic',
  },
  {
    id: 'cartesia-sonic-2',
    arenaId: 'cartesia:sonic-2',
    providerId: 'cartesia',
    name: 'Sonic 2',
  },
  {
    id: 'cartesia-sonic-3',
    arenaId: 'cartesia:sonic-3',
    providerId: 'cartesia',
    name: 'Sonic 3',
  },
  {
    id: 'cartesia-sonic-35',
    arenaId: 'cartesia:sonic-3.5-2026-05-04',
    providerId: 'cartesia',
    name: 'Sonic 3.5',
  },
  {
    id: 'xai-xai-tts',
    arenaId: 'xai:xai-tts',
    providerId: 'xai',
    name: 'Grok TTS',
  },
  {
    id: 'xai-streaming',
    arenaId: 'xai:streaming',
    providerId: 'xai',
    name: 'Grok TTS (Streaming)',
  },
  {
    id: 'minimax-minimax-tts',
    arenaId: 'minimax:minimax-tts',
    providerId: 'minimax',
    // Relabeled 2026-07-23 (was 'Speech 2.5'): MiniMax confirmed the
    // benchmarked generation was Speech 2.8. Frozen ids unchanged.
    name: 'Speech 2.8',
  },
  {
    id: 'minimax-speech-02-hd',
    arenaId: 'minimax:speech-02-hd',
    providerId: 'minimax',
    name: 'Speech 2 HD',
  },
  {
    id: 'minimax-speech-02-turbo',
    arenaId: 'minimax:speech-02-turbo',
    providerId: 'minimax',
    name: 'Speech 2 Turbo',
  },
  {
    id: 'gradium-gradium-tts',
    arenaId: 'gradium:gradiumtts',
    providerId: 'gradium',
    name: 'Gradium TTS',
  },
  {
    id: 'canopy-orpheus',
    arenaId: 'canopylabs:orpheus',
    providerId: 'canopylabs',
    name: 'Orpheus',
  },
  {
    id: 'inworld-tts-15-max',
    arenaId: 'inworld:tts-1-5-max',
    providerId: 'inworld',
    name: 'TTS-1.5-max',
  },
  {
    id: 'inworld-tts-2',
    arenaId: 'inworld:tts-2',
    providerId: 'inworld',
    name: 'TTS-2',
  },
  {
    id: 'smallestai-lightning-v31',
    arenaId: 'smallestai:lightning-v31',
    providerId: 'smallestai',
    name: 'Lightning v3.1',
  },
  {
    id: 'neuphonic-neu-hq',
    arenaId: 'neuphonic:neu-hq',
    providerId: 'neuphonic',
    name: 'neu_hq',
  },
  {
    id: 'speechify-simba-3-2',
    arenaId: 'speechify:simba-3-2',
    providerId: 'speechify',
    name: 'Simba 3.2',
  },
  {
    id: 'fish-s21-pro',
    arenaId: 'fish:s2-1-pro',
    providerId: 'fish',
    name: 'S2.1-Pro',
  },
  {
    id: 'human',
    arenaId: 'human:human',
    providerId: 'human',
    name: 'Homo Sapien',
  },
];

const EXPECTED_PROVIDERS = [
  { id: 'elevenlabs', name: 'ElevenLabs' },
  { id: 'cartesia', name: 'Cartesia' },
  { id: 'xai', name: 'xAI' },
  { id: 'minimax', name: 'MiniMax' },
  { id: 'gradium', name: 'Gradium' },
  { id: 'canopylabs', name: 'Canopy Labs' },
  { id: 'inworld', name: 'Inworld' },
  { id: 'smallestai', name: 'Smallest.ai' },
  { id: 'neuphonic', name: 'Neuphonic' },
  { id: 'speechify', name: 'Speechify' },
  { id: 'fish', name: 'Fish Audio' },
  { id: 'human', name: 'Human' },
];

const SOURCE_VOICE_IDS = [
  'voice-clara',
  'voice-emma',
  'voice-godfrey',
  'voice-nelliot',
];

describe('server/catalog derivation equality', () => {
  it('derives MODELS value-identical to the pre-registry catalog', () => {
    expect(MODELS).toEqual(EXPECTED_MODELS);
  });

  it('derives the active providers value-identical to the pre-registry catalog', () => {
    expect([...PROVIDERS_BY_ID.values()]).toEqual(EXPECTED_PROVIDERS);
  });

  it('derives the exact 88-variant matrix (ids feed the audio hashes)', () => {
    // The Human baseline now has clips for all four source voices, like every
    // other model.
    const HUMAN_VOICES = [
      'voice-clara',
      'voice-nelliot',
      'voice-godfrey',
      'voice-emma',
    ];
    const voicesFor = (modelId: string): string[] =>
      modelId === 'human' ? HUMAN_VOICES : SOURCE_VOICE_IDS;
    const expectedVariants = SOURCE_VOICE_IDS.flatMap((voiceId) =>
      EXPECTED_MODELS.filter((model) =>
        voicesFor(model.id).includes(voiceId),
      ).map((model) => ({
        id: `variant:${voiceId}:${model.providerId}:${model.arenaId.split(':', 2)[1]}`,
        sourceVoiceId: voiceId,
        providerId: model.providerId,
        modelId: model.id,
      })),
    );
    // 21 active TTS models x 4 voices + the Human baseline x 4 recorded
    // voices = 88 (retired models leave the variant matrix with the arena).
    expect(VARIANTS.length).toBe(88);
    expect(VARIANTS).toEqual(expectedVariants);
  });

  it('limits the Human baseline to its recorded source voices', () => {
    const humanVoices = VARIANTS.filter((v) => v.modelId === 'human')
      .map((v) => v.sourceVoiceId)
      .sort();
    // All four source voices are recorded now, so Human has a variant (and so
    // battles) on each of them.
    expect(humanVoices).toEqual([
      'voice-clara',
      'voice-emma',
      'voice-godfrey',
      'voice-nelliot',
    ]);
  });

  it('resolves the frozen audio content hashes (golden URLs)', () => {
    const goldens: Array<[string, string, string]> = [
      [
        'variant:voice-clara:xai:xai-tts',
        'clip-01',
        'cd6652b95882be688be45c6f0e0d3ff0',
      ],
      [
        'variant:voice-emma:xai:streaming',
        'clip-07',
        'cad0495af897b33de962af7c9bb214dc',
      ],
      [
        'variant:voice-godfrey:elevenlabs:eleven_flash_v2_5',
        'clip-13',
        '2f77e73d0fe4bcfe4769ed7f4f44329c',
      ],
      [
        'variant:voice-nelliot:cartesia:sonic-3.5-2026-05-04',
        'clip-20',
        '76f803cefea4c90953672d0c763d8fc2',
      ],
    ];
    for (const [variantId, promptId, hash] of goldens) {
      // Origin is env-configurable; the content hash is the invariant.
      expect(
        audioUrlFor(variantId, promptId).endsWith(`/audio/${hash}.mp3`),
      ).toBe(true);
    }
  });
});

/* --------------------------- Fallback clip pins ----------------------------
 * Offline fallbacks (registry sample clips + the fallback battles) are pinned
 * (variant, prompt, path) triples. Recomputing the content hash from the
 * identity must reproduce the pinned path, every pinned variant/prompt must
 * exist in the arena catalog, and battles must mirror real pairings (same
 * source voice + prompt on both sides). This is what keeps battles.ts a
 * derivation instead of a URL list.
 * -------------------------------------------------------------------------- */

describe('fallback clips', () => {
  const VARIANT_IDS = new Set(VARIANTS.map((variant) => variant.id));
  const expectDerivedClip = (clip: {
    variantId: string;
    promptId: string;
    path: string;
  }) => {
    expect(audioUrlFor(clip.variantId, clip.promptId).endsWith(clip.path)).toBe(
      true,
    );
    expect(PROMPTS_BY_ID.has(clip.promptId)).toBe(true);
  };

  it('every active model pins a sample clip of one of its own variants', () => {
    for (const model of arenaModelEntries()) {
      const clip = model.sample?.fallbackClip;
      expect(clip).toBeDefined();
      expectDerivedClip(clip!);
      expect(VARIANT_IDS.has(clip!.variantId)).toBe(true);
      expect(
        clip!.variantId.endsWith(`:${model.providerId}:${model.arenaApiId}`),
      ).toBe(true);
    }
  });

  it('any overlay entry clip still derives from its frozen identity', () => {
    // Not in the active VARIANTS matrix (unlisted), but the hash must hold
    // so re-listing resolves the already-hosted audio. Vacuous when the
    // overlay is empty (CI); exercised wherever a deploy overlay is present.
    for (const model of OVERLAY.models) {
      const clip = model.sample?.fallbackClip;
      if (clip) expectDerivedClip(clip);
    }
  });

  it('MODEL_SAMPLE_CLIPS derives one origin-prefixed URL per active model', () => {
    const active = arenaModelEntries();
    expect(Object.keys(MODEL_SAMPLE_CLIPS).length).toBe(active.length);
    for (const model of active) {
      expect(MODEL_SAMPLE_CLIPS[model.id]).toBe(
        `${ARENA_AUDIO_ORIGIN}${model.sample!.fallbackClip!.path}`,
      );
    }
  });

  it('fallback battles mirror real arena pairings and derive their URLs', () => {
    expect(FALLBACK_BATTLE_SPECS.length).toBeGreaterThan(0);
    for (const spec of FALLBACK_BATTLE_SPECS) {
      for (const side of [spec.left, spec.right]) {
        expect(modelEntryById(side.modelId)?.status).toBe('active');
        expectDerivedClip(side.clip);
        expect(VARIANT_IDS.has(side.clip.variantId)).toBe(true);
      }
      // Real pairings: different models reading the same prompt from the
      // same cloned source voice.
      expect(spec.left.modelId).not.toBe(spec.right.modelId);
      expect(spec.right.clip.variantId.split(':')[1]).toBe(
        spec.left.clip.variantId.split(':')[1],
      );
      expect(spec.right.clip.promptId).toBe(spec.left.clip.promptId);
      expect(PROMPTS_BY_ID.get(spec.left.clip.promptId)?.text).toBe(
        spec.prompt,
      );
    }
    for (const battle of HERO_BATTLES) {
      expect(battle.leftAudio.startsWith(`${ARENA_AUDIO_ORIGIN}/audio/`)).toBe(
        true,
      );
      expect(battle.rightAudio.startsWith(`${ARENA_AUDIO_ORIGIN}/audio/`)).toBe(
        true,
      );
    }
  });
});

/**
 * The exact pre-registry first-paint snapshot (the 2026-06-10 export),
 * now derived as seed-standings × registry identity.
 */
const EXPECTED_ARENA_ROWS = [
  {
    // The Human baseline anchor: seeded above the field so it is the unique
    // 100 from first paint. No competitive rank (blank label), 0 votes.
    id: 'human',
    provider: 'Human',
    model: 'Homo Sapien',
    elo: 1338,
    uncertainty: 160,
    wins: 0,
    losses: 0,
    ties: 0,
    likelyRank: '',
    voiceProfile: 24,
    baseline: true,
  },
  {
    id: 'xai-xai-tts',
    provider: 'xAI',
    model: 'Grok TTS',
    elo: 1307,
    uncertainty: 16,
    wins: 71,
    losses: 24,
    ties: 3,
    likelyRank: '#1-2',
    voiceProfile: 1,
  },
  {
    id: 'xai-streaming',
    provider: 'xAI',
    model: 'Grok TTS (Streaming)',
    elo: 1295,
    uncertainty: 18,
    wins: 58,
    losses: 17,
    ties: 1,
    likelyRank: '#1-2',
    voiceProfile: 2,
  },
  {
    id: 'cartesia-sonic-35',
    provider: 'Cartesia',
    model: 'Sonic 3.5',
    elo: 1257,
    uncertainty: 16,
    wins: 56,
    losses: 32,
    ties: 9,
    likelyRank: '#3-10',
    voiceProfile: 3,
  },
  {
    id: 'canopy-orpheus',
    provider: 'Canopy Labs',
    model: 'Orpheus',
    elo: 1257,
    uncertainty: 18,
    wins: 49,
    losses: 27,
    ties: 4,
    likelyRank: '#3-10',
    voiceProfile: 4,
  },
  // elevenlabs-turbo-v25 is seeded but retired (2026-07-23), so it no longer
  // reaches the first-paint rows.
  {
    id: 'elevenlabs-eleven-v3',
    provider: 'ElevenLabs',
    model: 'Eleven v3',
    elo: 1232,
    uncertainty: 16,
    wins: 55,
    losses: 41,
    ties: 5,
    likelyRank: '#3-13',
    voiceProfile: 6,
  },
  {
    id: 'elevenlabs-flash-v25',
    provider: 'ElevenLabs',
    model: 'Flash v2.5',
    elo: 1225,
    uncertainty: 16,
    wins: 52,
    losses: 40,
    ties: 8,
    likelyRank: '#3-13',
    voiceProfile: 7,
  },
  {
    id: 'minimax-minimax-tts',
    provider: 'MiniMax',
    // Display name renamed 2026-06-11 (MiniMax TTS -> Speech 2.5) and again
    // 2026-07-23 (Speech 2.5 -> Speech 2.8, per MiniMax); id frozen.
    model: 'Speech 2.8',
    elo: 1222,
    uncertainty: 16,
    wins: 48,
    losses: 41,
    ties: 9,
    likelyRank: '#5-13',
    voiceProfile: 8,
  },
  {
    id: 'elevenlabs-flash-v2',
    provider: 'ElevenLabs',
    model: 'Flash v2',
    elo: 1208,
    uncertainty: 16,
    wins: 48,
    losses: 43,
    ties: 6,
    likelyRank: '#5-13',
    voiceProfile: 9,
  },
  {
    id: 'elevenlabs-turbo-v2',
    provider: 'ElevenLabs',
    model: 'Turbo v2',
    elo: 1201,
    uncertainty: 16,
    wins: 46,
    losses: 40,
    ties: 11,
    likelyRank: '#6-13',
    voiceProfile: 10,
  },
  {
    id: 'inworld-tts-15-max',
    provider: 'Inworld',
    model: 'TTS-1.5-max',
    elo: 1197,
    uncertainty: 72,
    wins: 2,
    losses: 3,
    ties: 0,
    likelyRank: '#3-14',
    voiceProfile: 11,
  },
  {
    id: 'inworld-tts-2',
    provider: 'Inworld',
    model: 'TTS-2',
    elo: 1189,
    uncertainty: 72,
    wins: 1,
    losses: 4,
    ties: 0,
    likelyRank: '#3-14',
    voiceProfile: 13,
  },
  {
    id: 'cartesia-sonic-2',
    provider: 'Cartesia',
    model: 'Sonic 2',
    elo: 1140,
    uncertainty: 16,
    wins: 36,
    losses: 59,
    ties: 2,
    likelyRank: '#11-14',
    voiceProfile: 15,
  },
  {
    id: 'gradium-gradium-tts',
    provider: 'Gradium',
    model: 'Gradium TTS',
    elo: 1099,
    uncertainty: 16,
    wins: 20,
    losses: 69,
    ties: 6,
    likelyRank: '#15-16',
    voiceProfile: 16,
  },
  {
    id: 'cartesia-sonic-3',
    provider: 'Cartesia',
    model: 'Sonic 3',
    elo: 1097,
    uncertainty: 16,
    wins: 27,
    losses: 61,
    ties: 8,
    likelyRank: '#15-16',
    voiceProfile: 17,
  },
  {
    id: 'cartesia-sonic',
    provider: 'Cartesia',
    model: 'Sonic',
    elo: 1028,
    uncertainty: 16,
    wins: 13,
    losses: 82,
    ties: 4,
    likelyRank: '#16',
    voiceProfile: 18,
  },
];

describe('data/models derivation equality', () => {
  it('derives ARENA_ROWS value-identical to the pre-registry snapshot', () => {
    expect(ARENA_ROWS).toEqual(EXPECTED_ARENA_ROWS);
  });

  it('keeps the seed vote total', () => {
    expect(SEED_TOTAL_UNIQUE_VOTES).toBe(721);
  });

  it('mergeStandings keeps fingerprints stable and falls back by position', () => {
    const liveRow = {
      id: 'cartesia-sonic',
      provider: 'Cartesia',
      model: 'Sonic',
      elo: 1031.5,
      uncertainty: 15,
      rankRange: '#16',
      wins: 14,
      losses: 82,
      ties: 4,
      voteCount: 100,
    };
    const unknownRow = {
      ...liveRow,
      id: 'acme-mystery',
      provider: 'Acme',
      model: 'Mystery',
    };
    const merged = mergeStandings([liveRow, unknownRow]);
    expect(merged[0].voiceProfile).toBe(18);
    expect(merged[0].likelyRank).toBe('#16');
    expect(merged[1].voiceProfile).toBe(2);
  });
});

/**
 * Expected voiceStats for the full field: the exact pre-registry outputs for
 * the original models, plus the June 2026 registry additions. Both Grok
 * configs are measured on their shared WS API with opposite
 * optimize_streaming_latency flag states (see catalog/models.ts).
 */
const EXPECTED_VOICE_STATS: Array<[string, string, string, string, string]> = [
  // [provider, model, latency, langs, price]
  ['xAI', 'Grok TTS', '460 ms', '20', '$15'],
  ['xAI', 'Grok TTS (Streaming)', '285 ms', '20', '$15'],
  ['Cartesia', 'Sonic 3.5', '128 ms', '42', '$50'],
  ['Cartesia', 'Sonic 3', '166 ms', '42', '$50'],
  ['Cartesia', 'Sonic 2', '159 ms', '15', '$50'],
  ['Cartesia', 'Sonic', '116 ms', '15', '$50'],
  ['Canopy Labs', 'Orpheus', '\u2014', 'English', 'Open source'],
  ['ElevenLabs', 'Turbo v2', '302 ms', 'English', '$50'],
  ['ElevenLabs', 'Flash v2', '226 ms', 'English', '$50'],
  ['ElevenLabs', 'Flash v2.5', '197 ms', '32', '$50'],
  ['ElevenLabs', 'Eleven v3', '758 ms', '70+', '$100'],
  ['MiniMax', 'Speech 2.8', '325 ms', '40', '$60'],
  ['MiniMax', 'Speech 2 HD', '357 ms', '32', '$100'],
  ['MiniMax', 'Speech 2 Turbo', '315 ms', '32', '$60'],
  ['Inworld', 'TTS-1.5-max', '337 ms', '15', '$35'],
  ['Inworld', 'TTS-2', '288 ms', '100+', '$25'],
  ['Gradium', 'Gradium TTS', '332 ms', '5', '$58'],
  // No published Neuphonic API pricing as of 2026-06-12 (renders a dash).
  ['Neuphonic', 'neu_hq', '276 ms', '9', '\u2014'],
  ['Smallest.ai', 'Lightning v3.1', '420 ms', '12', '$15'],
  // Vendor-rendered clips, but the latency is our own: benched 2026-07-30
  // against a Speechify key once one arrived (bench-only transport).
  ['Speechify', 'Simba 3.2', '428 ms', 'English', '$10'],
  // The Human baseline is a real person reading the line: no latency, no
  // languages count, no price. All dashes.
  ['Human', 'Homo Sapien', '\u2014', '\u2014', '\u2014'],
];

describe('data/providers derivation equality', () => {
  it('derives voiceStats value-identical for the full field', () => {
    for (const [
      provider,
      model,
      latency,
      langs,
      price,
    ] of EXPECTED_VOICE_STATS) {
      expect(voiceStats({ provider, model })).toEqual({
        latency,
        langs,
        price,
      });
    }
  });

  it('keeps dashes for unlisted and unknown rows (no vendor estimates)', () => {
    const dash = { latency: '\u2014', langs: '\u2014', price: '\u2014' };
    // Unlisted overlay entries resolve to nothing, exactly like unknowns.
    for (const model of OVERLAY.models) {
      const provider = providerEntryById(model.providerId)!;
      expect(voiceStats({ provider: provider.name, model: model.name })).toEqual(
        dash,
      );
    }
    expect(voiceStats({ provider: 'Acme Voice Co', model: 'Mystery' })).toEqual(
      dash,
    );
  });

  it('derives the exact marks record (overlay brand assets stay wired)', () => {
    expect(PROVIDER_MARKS).toEqual({
      ElevenLabs: 'elevenlabs.svg',
      Cartesia: 'cartesia.png',
      xAI: 'xai.svg',
      MiniMax: 'minimax.svg',
      Gradium: 'gradium.svg',
      'Canopy Labs': 'canopy.svg',
      Inworld: 'inworld.png',
      'Smallest.ai': 'smallestai.png',
      Neuphonic: 'neuphonic.png',
      Speechify: 'speechify.svg',
      'Fish Audio': 'fish.svg',
      Human: 'human.svg',
      // Overlay providers keep their marks wired for re-listing.
      ...Object.fromEntries(
        OVERLAY.providers.map((provider) => [provider.name, provider.mark]),
      ),
    });
  });

  it('derives monograms and initials exactly', () => {
    const expected: Array<[string, string]> = [
      ['xAI', 'xAI'],
      ['Cartesia', 'C'],
      ['Canopy Labs', 'CL'],
      ['ElevenLabs', '11'],
      ['MiniMax', 'MM'],
      ['Inworld', 'IW'],
      ['Gradium', 'G'],
      ['Smallest.ai', 'S'],
      ['Neuphonic', 'N'],
      ['Speechify', 'S'],
      ['Human', 'H'],
      ['Acme Voice Co', 'AV'],
    ];
    for (const [provider, text] of expected) {
      expect(brandLogoText(provider)).toBe(text);
    }
    // Overlay providers resolve their declared monogram.
    for (const provider of OVERLAY.providers) {
      if (provider.monogram) {
        expect(brandLogoText(provider.name)).toBe(provider.monogram);
      }
    }
  });

  it('serves the featured blurb from the registry with the generic fallback', () => {
    expect(
      modelBlurb({ id: 'xai-xai-tts', provider: 'xAI', model: 'Grok TTS' }),
    ).toContain('the voice to beat');
    const fallback = modelBlurb({
      id: 'cartesia-sonic-35',
      provider: 'Cartesia',
      model: 'Sonic 3.5',
    });
    expect(fallback).toContain('Cartesia Sonic 3.5');
    expect(fallback).toContain('Humanness Index™');
  });
});

/* --------------------------- Unlisted exclusion ----------------------------
 * Every check iterates the overlay so the suite holds for any overlay state:
 * vacuous with the empty default (CI), fully exercised wherever a deploy
 * overlay carries unlisted entries.
 * -------------------------------------------------------------------------- */

describe('unlisted entries are excluded from every derived surface', () => {
  it('keeps each overlay entry wired for re-listing', () => {
    for (const model of OVERLAY.models) {
      const entry = modelEntryById(model.id)!;
      expect(entry).toBeDefined();
      expect(entry.status).toBe('unlisted');
      expect(entry.voiceProfile).toBeGreaterThan(0);
      const provider = providerEntryById(model.providerId)!;
      expect(provider).toBeDefined();
      expect(provider.mark.length).toBeGreaterThan(0);
    }
  });

  it('is absent from the arena catalog (models, variants, providers)', () => {
    for (const model of OVERLAY.models) {
      expect(MODELS_BY_ID.has(model.id)).toBe(false);
      expect(variantsOfModel(model.id)).toEqual([]);
    }
    for (const provider of OVERLAY.providers) {
      expect(MODELS.some((model) => model.providerId === provider.id)).toBe(
        false,
      );
      expect(PROVIDERS_BY_ID.has(provider.id)).toBe(false);
      expect(
        VARIANTS.some((variant) => variant.providerId === provider.id),
      ).toBe(false);
    }
  });

  it('is absent from the first-paint standings', () => {
    for (const model of OVERLAY.models) {
      expect(ARENA_ROWS.some((row) => row.id === model.id)).toBe(false);
    }
    // First paint is active seed rows only: retired seeded models (Turbo
    // v2.5 as of 2026-07-23) are filtered with the unlisted ones.
    expect(ARENA_ROWS.length).toBe(
      SEED_STANDINGS.models.filter(
        (row) => modelEntryById(row.id)?.status === 'active',
      ).length,
    );
  });

  it('is absent from stats, latency plots, and display lookups', () => {
    for (const model of OVERLAY.models) {
      const provider = providerEntryById(model.providerId)!;
      expect(
        modelEntryByDisplayName(provider.name, model.name),
      ).toBeUndefined();
      expect(
        parseLatencyMs({ provider: provider.name, model: model.name }),
      ).toBeNull();
    }
  });

  it('is absent from the page/sitemap surfaces', () => {
    for (const model of OVERLAY.models) {
      expect(
        listedModelEntries().some((entry) => entry.id === model.id),
      ).toBe(false);
    }
    for (const provider of OVERLAY.providers) {
      expect(
        listedProviderEntries().some((entry) => entry.id === provider.id),
      ).toBe(false);
    }
    expect(listedModelEntries().length).toBe(24);
    expect(listedProviderEntries().length).toBe(12);
  });
});

/* ---------------------------- Retired exclusion ----------------------------
 * Retired entries (Turbo v2.5 + Multilingual v2 as of 2026-07-23) leave the
 * arena and the first paint but keep their pages: an earned URL never 404s.
 * -------------------------------------------------------------------------- */

describe('retired entries leave the arena but keep their pages', () => {
  const RETIRED_IDS = ['elevenlabs-turbo-v25', 'elevenlabs-multilingual-v2'];

  it('is out of battles, first paint, and offline samples', () => {
    for (const id of RETIRED_IDS) {
      expect(modelEntryById(id)?.status).toBe('retired');
      expect(MODELS_BY_ID.has(id)).toBe(false);
      expect(variantsOfModel(id)).toEqual([]);
      expect(ARENA_ROWS.some((row) => row.id === id)).toBe(false);
      expect(MODEL_SAMPLE_CLIPS[id]).toBeUndefined();
    }
  });

  it('stays on the page/sitemap surfaces with resolvable stats identity', () => {
    for (const id of RETIRED_IDS) {
      const entry = listedModelEntries().find((model) => model.id === id);
      expect(entry).toBeDefined();
      expect(entry!.copy.length).toBeGreaterThanOrEqual(2);
    }
  });
});

/* ------------------------- Spec'd slug expectations ------------------------ */

describe('frozen URL slugs (adjusted for the Grok rename)', () => {
  it('pins the model slug table', () => {
    const slugById = new Map(MODEL_ENTRIES.map((m) => [m.id, m.slug]));
    expect(slugById.get('xai-xai-tts')).toBe('grok-tts');
    expect(slugById.get('xai-streaming')).toBe('grok-tts-streaming');
    expect(slugById.get('cartesia-sonic-35')).toBe('cartesia-sonic-3-5');
    expect(slugById.get('elevenlabs-turbo-v25')).toBe('elevenlabs-turbo-v2-5');
    expect(slugById.get('elevenlabs-flash-v25')).toBe('elevenlabs-flash-v2-5');
    expect(slugById.get('minimax-minimax-tts')).toBe('minimax-tts');
    expect(slugById.get('gradium-gradium-tts')).toBe('gradium-tts');
    expect(slugById.get('inworld-tts-15-max')).toBe('inworld-tts-1-5-max');
    expect(slugById.get('smallestai-lightning-v31')).toBe(
      'smallestai-lightning-v31',
    );
    expect(slugById.get('neuphonic-neu-hq')).toBe('neuphonic-neu-hq');
    expect(slugById.get('speechify-simba-3-2')).toBe('speechify-simba-3-2');
    expect(slugById.get('fish-s21-pro')).toBe('fish-s2-1-pro');
    expect(slugById.get('human')).toBe('human');
    // Overlay slugs are frozen identity too: id and slug must already agree
    // with the store before an entry ever goes public.
    for (const model of OVERLAY.models) {
      expect(model.slug).toMatch(SLUG_PATTERN);
    }
  });

  it('pins the provider slug table', () => {
    expect(BASE_PROVIDER_ENTRIES.map((p) => p.slug).sort()).toEqual([
      'canopy-labs',
      'cartesia',
      'elevenlabs',
      'fish-audio',
      'gradium',
      'human-baseline',
      'inworld',
      'minimax',
      'neuphonic',
      'smallest-ai',
      'speechify',
      'xai',
    ]);
  });
});
