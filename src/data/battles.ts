import {
  arenaClipUrl,
  arenaModelEntries,
  pinnedClip,
  type FallbackClip,
} from '../catalog';
import type { HeroBattle } from '../lib/types';

export const SAMPLE_PHRASE =
  'Thanks for calling! Let me pull up your account real quick.';

/**
 * Each voice in a head-to-head plays for a fixed, visible window so the
 * playback animation always runs — browser speech timing is unreliable
 * (the first utterance is often dropped).
 */
export const PLAY_MS = 3800;
export const GAP_MS = 460;

/**
 * Offline/dev fallback rounds, used only when the battle API is unreachable
 * (live rounds come from GET /api/battle). Each side pins a hosted
 * clip by its (variant, prompt) identity; both sides of a round share the
 * same source voice and prompt, like real arena pairings. catalog.test
 * enforces that every pinned path equals the recomputed content hash and
 * that each prompt string equals the catalog prompt text.
 */
type FallbackBattleSpec = {
  prompt: string;
  left: { modelId: string; clip: FallbackClip };
  right: { modelId: string; clip: FallbackClip };
};

export const FALLBACK_BATTLE_SPECS: FallbackBattleSpec[] = [
  {
    prompt:
      "So I can see here that the package was marked as delivered on Tuesday, but if you're saying it never arrived then what we'll do is... let me just. Yeah, I'm going to open a lost package investigation for you. That usually takes about forty-eight hours to resolve.",
    left: {
      modelId: 'elevenlabs-flash-v25',
      clip: pinnedClip(
        'voice-nelliot',
        'elevenlabs',
        'eleven_flash_v2_5',
        'clip-09',
        'bb402e582ff1f7031053c7088253d1aa',
      ),
    },
    right: {
      modelId: 'inworld-tts-15-max',
      clip: pinnedClip(
        'voice-nelliot',
        'inworld',
        'tts-1-5-max',
        'clip-09',
        'f15038c61c53cea2256b3e0293d3cd4e',
      ),
    },
  },
  {
    prompt:
      "Right, so I see what happened here. Your old plan was grandfathered in at the lower rate, and when the system updated it... it switched you to the current pricing. That shouldn't have happened. Let me get you back on the original rate.",
    left: {
      modelId: 'xai-streaming',
      clip: pinnedClip(
        'voice-clara',
        'xai',
        'streaming',
        'clip-15',
        '5d8aee4c5008a4c215dd57be179dafb2',
      ),
    },
    right: {
      modelId: 'inworld-tts-2',
      clip: pinnedClip(
        'voice-clara',
        'inworld',
        'tts-2',
        'clip-15',
        'e94cb897604f768ad8234da8c22cc0b0',
      ),
    },
  },
  {
    prompt:
      "Hmm, that's interesting. I'm noticing there was a slight delay around the time you submitted it. Oh wait, sorry, I was looking at the wrong timestamp there. Let me switch over to the correct one. Yeah, okay, now I'm seeing it properly. So it looks like the system flagged it automatically, which is probably why you got that notification.",
    left: {
      modelId: 'cartesia-sonic',
      clip: pinnedClip(
        'voice-emma',
        'cartesia',
        'sonic',
        'clip-07',
        'b7faecc06a45e5b2458ba62e292a4cbb',
      ),
    },
    right: {
      modelId: 'inworld-tts-2',
      clip: pinnedClip(
        'voice-emma',
        'inworld',
        'tts-2',
        'clip-07',
        '142adc58cf6370f4f241f0dac7a5325d',
      ),
    },
  },
];

export const HERO_BATTLES: HeroBattle[] = FALLBACK_BATTLE_SPECS.map((spec) => ({
  voteToken: null,
  prompt: spec.prompt,
  leftModelId: spec.left.modelId,
  rightModelId: spec.right.modelId,
  leftAudio: arenaClipUrl(spec.left.clip),
  rightAudio: arenaClipUrl(spec.right.clip),
}));

/**
 * Per-model offline sample clip for the Listen buttons, derived from each
 * registry entry's pinned `sample.fallbackClip` (live samples come from
 * GET /api/sample).
 */
export const MODEL_SAMPLE_CLIPS: Record<string, string> = Object.fromEntries(
  arenaModelEntries().flatMap((model) =>
    model.sample?.fallbackClip
      ? [[model.id, arenaClipUrl(model.sample.fallbackClip)]]
      : [],
  ),
);
