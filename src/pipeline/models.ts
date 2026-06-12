/**
 * Pipeline model resolution.
 *
 * Registered models come straight from the registry (../catalog) so anything
 * in catalog/models.ts is generatable/benchable with zero extra wiring. The
 * NEW_MODELS table below covers models whose clips must be generated BEFORE
 * they enter the registry (the strict sequencing rule: clips uploaded +
 * verified first, registry second). Once a model is registered its registry
 * entry wins and the NEW_MODELS row is dead weight that can be deleted.
 */
import { MODEL_ENTRIES } from '../catalog';

export type PipelineModel = {
  /** Registry id (or future id for unregistered models). */
  id: string;
  slug: string;
  providerId: string;
  /** Frozen arena api id — feeds variant ids and audio content hashes. */
  arenaApiId: string;
  /** The model id the vendor's API expects. */
  vendorModelId: string;
  name: string;
  registered: boolean;
};

/**
 * Vendor API ids for registry entries whose frozen `apiModelId` is not the
 * literal id the provider endpoint accepts today.
 */
const VENDOR_MODEL_ID_OVERRIDES: Record<string, string> = {
  // Inworld's registry ids are frozen without dots; the API wants the
  // `inworld-` prefixed dotted form (docs.inworld.ai/tts/tts-models).
  'inworld-tts-15-max': 'inworld-tts-1.5-max',
  'inworld-tts-2': 'inworld-tts-2',
};

/**
 * Models whose clips are generated ahead of registration. providerId and
 * arenaApiId feed the audio content hashes, so they are FROZEN FOREVER once
 * a model's clips are hashed — graduated rows get deleted, never edited.
 */
const NEW_MODELS: PipelineModel[] = [
  // The Inworld pair stays here until cloning unblocks (the borrowed
  // INWORLD_API_KEY lacks the `voices` write scope — see RUNBOOK.md).
  {
    // PARKED (2026-06-12): clips hosted + HEAD-verified, but Neuphonic's
    // API ignores the `model` field, so they came from the same served
    // pool as neuphonic-neu-hq's — registering both would put two names
    // on one system. Revisit if Neuphonic re-honors the field (the request
    // body did send `model: neu_fast`). Full story: RUNBOOK status table.
    id: 'neuphonic-neu-fast',
    slug: 'neuphonic-neu-fast',
    providerId: 'neuphonic',
    arenaApiId: 'neu-fast',
    vendorModelId: 'neu_fast',
    name: 'neu_fast',
    registered: false,
  },
  {
    id: 'inworld-tts-1',
    slug: 'inworld-tts-1',
    providerId: 'inworld',
    arenaApiId: 'tts-1',
    vendorModelId: 'inworld-tts-1',
    name: 'TTS-1',
    registered: false,
  },
  {
    id: 'inworld-tts-15-mini',
    slug: 'inworld-tts-1-5-mini',
    providerId: 'inworld',
    arenaApiId: 'tts-1-5-mini',
    vendorModelId: 'inworld-tts-1.5-mini',
    name: 'TTS-1.5 Mini',
    registered: false,
  },
];

const registryModels = (): PipelineModel[] =>
  MODEL_ENTRIES.map((entry) => ({
    id: entry.id,
    slug: entry.slug,
    providerId: entry.providerId,
    arenaApiId: entry.arenaApiId,
    vendorModelId: VENDOR_MODEL_ID_OVERRIDES[entry.id] ?? entry.apiModelId,
    name: entry.name,
    registered: true,
  }));

/** Registry models first; NEW_MODELS rows only where not yet registered. */
export const pipelineModels = (): PipelineModel[] => {
  const fromRegistry = registryModels();
  const registeredIds = new Set(fromRegistry.map((model) => model.id));
  return [
    ...fromRegistry,
    ...NEW_MODELS.filter((model) => !registeredIds.has(model.id)),
  ];
};

/** Resolve by registry id, slug, or `provider/arenaApiId` key. */
export const resolvePipelineModel = (key: string): PipelineModel => {
  const models = pipelineModels();
  const match = models.find(
    (model) =>
      model.id === key ||
      model.slug === key ||
      `${model.providerId}/${model.arenaApiId}` === key,
  );
  if (!match) {
    const known = models
      .map((model) => `  ${model.id} (${model.providerId}/${model.arenaApiId})`)
      .join('\n');
    throw new Error(`Unknown model "${key}". Known models:\n${known}`);
  }
  return match;
};
