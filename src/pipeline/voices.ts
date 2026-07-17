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
  elevenlabs: {
    'voice-clara': 'ScCxrqX5aNtDVkIsrVZ1',
    'voice-emma': 'xMG5lL0U1x81qhneSMar',
    'voice-godfrey': '0jNCeOHaNZsiWL2WCbBV',
    'voice-nelliot': 'YcoL0DQXdQl4JjCqteDM',
  },
  cartesia: {
    'voice-clara': 'a5d537b0-4a5f-464d-ac12-d143fe1a0a36',
    'voice-emma': '2206880c-55e3-445a-a83c-fa2196a9f304',
    'voice-godfrey': '589d6fbc-d04d-46c3-91e4-a97979eca151',
    'voice-nelliot': '621a0684-2a58-4693-b762-a54093bf0c4c',
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
  speechify: {},
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

/** Full 4-voice map for a provider, or a clear error naming what is missing. */
export const requireVoiceMap = (
  providerId: string,
): Record<SourceVoiceId, string> => {
  const map = clonedVoiceIds()[providerId] ?? {};
  const missing = SOURCE_VOICE_IDS.filter((voiceId) => !map[voiceId]);
  if (missing.length > 0) {
    throw new Error(
      `Provider ${providerId} is missing cloned voice ids for: ${missing.join(', ')}. ` +
        `Run \`bun run humanness:clone ${providerId} <source-clips-dir>\` first (see pipeline/RUNBOOK.md).`,
    );
  }
  return map as Record<SourceVoiceId, string>;
};

export { LOCAL_VOICES_PATH };
