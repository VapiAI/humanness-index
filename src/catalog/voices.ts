/**
 * The licensed source voices the arena clones, in frozen roster order. This
 * roster feeds the variant matrix and the audio content hashes (see
 * server/catalog.ts), so the ids are frozen.
 *
 * Every TTS provider cloned all four voices, so models serve the whole roster
 * by default. A model that only has clips for a subset (e.g. the Human
 * baseline, whose recordings arrive voice by voice) declares the subset it
 * serves via ModelEntry.sourceVoices; the arena then only builds variants and
 * battles for those voices. Client-safe: plain data, no node builtins.
 */
export const SOURCE_VOICE_IDS = [
  'voice-clara',
  'voice-emma',
  'voice-godfrey',
  'voice-nelliot',
] as const;

export type SourceVoiceId = (typeof SOURCE_VOICE_IDS)[number];
