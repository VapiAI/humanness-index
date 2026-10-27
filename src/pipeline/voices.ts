/// <reference types="bun" />
/**
 * Cloned-voice-id registry: provider → source voice → provider voice id.
 *
 * The four licensed source voices (Clara, Emma, Godfrey, Nelliot) were
 * cloned on each provider once; every clip a provider's models generate
 * uses these clone ids. The static ids below match the clips already hosted
 * on the audio origin.
 *
 * New providers get their ids from `cloneVoices.ts`, which persists them to
 * pipeline/voices.local.json (gitignored, machine state). That file is
 * merged over this table at load, so freshly registered clones are
 * immediately usable by generateClips without a code edit.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const SOURCE_VOICE_IDS = [
  'voice-clara',
  'voice-emma',
  'voice-godfrey',
  'voice-nelliot',
] as const;

export type SourceVoiceId = (typeof SOURCE_VOICE_IDS)[number];

export type VoiceMap = Partial<Record<SourceVoiceId, string>>;

/** Clone ids for the active source voices (match the hosted clips). */
const STATIC_CLONED_VOICE_IDS: Record<string, VoiceMap> = {
  // Falcon 2.1 instant clones of the licensed masters, created 2026-10-27.
  murf: {
    'voice-clara': 'cln_017930245726003MM_017931182460928G3',
    'voice-emma': 'cln_017930245726003MM_017931182516193HD',
    'voice-godfrey': 'cln_017930245726003MM_017931182581654CJ',
    'voice-nelliot': 'cln_017930245726003MM_017931182650377KC',
  },
  elevenlabs: {
    'voice-clara': 'ScCxrqX5aNtDVkIsrVZ1',
    'voice-emma': 'xMG5lL0U1x81qhneSMar',
    'voice-godfrey': '0jNCeOHaNZsiWL2WCbBV',
    'voice-nelliot': 'YcoL0DQXdQl4JjCqteDM',
  },
  // Fresh IVCs from the licensed source recordings, verified on both v4
  // models. Keep the earlier models' professional-clone map unchanged.
  'elevenlabs-v4': {
    'voice-clara': '8gfyLJBl74bSIkLdjo6i',
    'voice-emma': 'lMvwNeETciJrFHgoxr14',
    'voice-godfrey': 'bK0wdWcE86kPv8pU6AUv',
    'voice-nelliot': 'PC50bwd8nb5m2FErOfAW',
  },
  // Existing Vapi-owned V3 professional clones, recovered 2026-10-26.
  // Each lists sonic-3.6-2026-08-27 in fine_tunes.public_model_id.
  // Provider handles changed; arena voice identities and hosted hashes do not.
  cartesia: {
    'voice-clara': 'ab8dcf7d-107f-49b4-8a04-19e77470e6a5',
    'voice-emma': '2f3dc5c2-03c8-4e4f-a99a-75966faa7cec',
    'voice-godfrey': '09a27b75-0045-4195-b016-0f844a3a35a3',
    'voice-nelliot': 'b21691f2-a798-4835-8c1f-016a0d04f77c',
  },
  minimax: {
    // MiniMax voice_ids are caller-chosen at clone time, so the four source
    // voices use these canonical arena ids verbatim.
    'voice-clara': 'minimax-clara',
    'voice-emma': 'minimax-emma',
    'voice-godfrey': 'minimax-godfrey',
    'voice-nelliot': 'minimax-nelliot',
  },
  // Inworld: clones pending. The current INWORLD_API_KEY authenticates for
  // synthesis but lacks the `voices` write scope needed to create clones. Use
  // a key with that scope (or clone the four voices in the provider portal),
  // then record the ids: `humanness:clone inworld --record voice-clara=<id> ...`.
  inworld: {},
  // Slots for expansion providers, filled by `humanness:clone` into
  // voices.local.json (source masters in results/source-voices/originals/).
  // The active smallestai + neuphonic ids already live in voices.local.json.
  smallestai: {},
  neuphonic: {},
  hume: {},
  sesame: {},
};

const LOCAL_VOICES_PATH = resolve(import.meta.dir, 'voices.local.json');

const loadLocalVoices = (): Record<string, VoiceMap> => {
  if (!existsSync(LOCAL_VOICES_PATH)) return {};
  return JSON.parse(readFileSync(LOCAL_VOICES_PATH, 'utf8')) as Record<
    string,
    VoiceMap
  >;
};

/** Static table merged with locally registered clones (local wins). */
export const clonedVoiceIds = (): Record<string, VoiceMap> => {
  const local = loadLocalVoices();
  const merged: Record<string, VoiceMap> = {};
  for (const providerId of new Set([
    ...Object.keys(STATIC_CLONED_VOICE_IDS),
    ...Object.keys(local),
  ])) {
    merged[providerId] = {
      ...STATIC_CLONED_VOICE_IDS[providerId],
      ...local[providerId],
    };
  }
  return merged;
};

/** Some model families need different clones without changing older renders. */
export const voiceMapKeyForModel = (providerId: string, vendorModelId?: string): string =>
  providerId === 'elevenlabs' &&
  (vendorModelId === 'eleven_v4' || vendorModelId === 'eleven_v4_turbo')
    ? 'elevenlabs-v4'
    : providerId;

/** Full 4-voice map for a provider/model, or a clear missing-clone error. */
export const requireVoiceMap = (
  providerId: string,
  vendorModelId?: string,
): Record<SourceVoiceId, string> => {
  const mapKey = voiceMapKeyForModel(providerId, vendorModelId);
  const map = clonedVoiceIds()[mapKey] ?? {};
  const missing = SOURCE_VOICE_IDS.filter((voiceId) => !map[voiceId]);
  if (missing.length > 0) {
    throw new Error(
      `Voice map ${mapKey} is missing cloned voice ids for: ${missing.join(', ')}. ` +
        `Run \`bun run humanness:clone ${providerId} <source-clips-dir>\`` +
        (vendorModelId ? ' with --model <catalog-model-id>' : '') +
        ' first (see pipeline/RUNBOOK.md).',
    );
  }
  return map as Record<SourceVoiceId, string>;
};

export { LOCAL_VOICES_PATH };
