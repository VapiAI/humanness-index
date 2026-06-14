/**
 * The arena catalog — a direct port of the original prototype's seed state.
 * Provider/model IDENTITY now derives
 * from the registry (../catalog, the single source of truth); licensed
 * source voices, the variant matrix (voice × provider × model), and the 20
 * customer-support prompts are arena mechanics and stay immutable here. Only
 * vote-driven stats persist (see store.ts).
 *
 * Audio: every (variant × prompt) clip was pre-generated and lives in this
 * project's Vercel Blob store under a content hash of
 * `{variantId}|{promptId}|settings-v3` — we compute the same hashes so the
 * ~1,700 MP3s resolve unchanged. catalog.test.ts asserts the derived
 * MODELS/VARIANTS are value-identical to the pre-registry catalog (any drift
 * in arenaId would orphan the hosted clips).
 */
import { createHash } from 'node:crypto';

import {
  ARENA_AUDIO_ORIGIN,
  arenaModelEntriesOfProvider,
  arenaProviderEntries,
  modelEntryById,
  SOURCE_VOICE_IDS,
} from '../catalog';

type CatalogProvider = {
  id: string;
  name: string;
};

type CatalogModel = {
  /** Frontend slug, e.g. `xai-xai-tts` (matches data/models.ts). */
  id: string;
  /** Arena model id, e.g. `xai:xai-tts` (used in variant/audio hashing). */
  arenaId: string;
  providerId: string;
  name: string;
};

type CatalogVoice = {
  id: string;
  name: string;
};

export type CatalogVariant = {
  /** Arena variant id, e.g. `variant:voice-clara:xai:xai-tts`. */
  id: string;
  sourceVoiceId: string;
  providerId: string;
  /** Frontend model slug. */
  modelId: string;
};

type CatalogPrompt = {
  id: string;
  text: string;
};

/**
 * Identity derives from the registry: providers with ≥1 active model, in
 * frozen registry order. Unlisted entries (models tested before a public
 * announcement) never enter the arena; their stats persist in the
 * production blob and are simply skipped while absent here.
 */
const PROVIDERS: CatalogProvider[] = arenaProviderEntries().map(
  ({ id, name }) => ({
    id,
    name,
  }),
);

export const MODELS: CatalogModel[] = PROVIDERS.flatMap((provider) =>
  arenaModelEntriesOfProvider(provider.id).map((entry) => ({
    id: entry.id,
    // arenaApiId is frozen in the registry — it feeds the variant ids and
    // audio content hashes below.
    arenaId: `${provider.id}:${entry.arenaApiId}`,
    providerId: provider.id,
    name: entry.name,
  })),
);

const SOURCE_VOICES: CatalogVoice[] = [
  { id: 'voice-clara', name: 'Clara' },
  { id: 'voice-emma', name: 'Emma' },
  { id: 'voice-godfrey', name: 'Godfrey' },
  { id: 'voice-nelliot', name: 'Nelliot' },
];

/**
 * The source voices a model serves: its registry `sourceVoices` subset, or the
 * whole roster by default (every TTS provider cloned all four). Restricting
 * this is what keeps a model (the Human baseline, mid-rollout) out of voices
 * it has no clips for.
 */
const voicesForModel = (modelId: string): readonly string[] =>
  modelEntryById(modelId)?.sourceVoices ?? SOURCE_VOICE_IDS;

// Most models cloned every rostered voice (the full matrix); a model that only
// has clips for a subset (see ModelEntry.sourceVoices) contributes variants
// for just those voices, so it is never paired on a voice it lacks.
export const VARIANTS: CatalogVariant[] = SOURCE_VOICES.flatMap((voice) =>
  MODELS.filter((model) => voicesForModel(model.id).includes(voice.id)).map(
    (model) => ({
      // variant:{voice}:{provider}:{arena model api id}
      id: `variant:${voice.id}:${model.providerId}:${model.arenaId.split(':', 2)[1]}`,
      sourceVoiceId: voice.id,
      providerId: model.providerId,
      modelId: model.id,
    }),
  ),
);

/** The 20 customer-support prompts every model reads (frozen since the original prototype). */
export const PROMPTS: CatalogPrompt[] = [
  {
    id: 'clip-01',
    text: "Okay so I'm pulling up your account right now and it looks like... oh wait, that's not the right one. Let me search by your email instead. Yeah okay, here we go, I can see the charge you're talking about.",
  },
  {
    id: 'clip-02',
    text: "So the issue with your order is that it was... it got flagged by our system for some reason, which is why it hasn't shipped yet. I'm going to go ahead and, um, manually push that through for you. You should get a confirmation email within the hour.",
  },
  {
    id: 'clip-03',
    text: "Right, so what you'll want to do is go into your account settings and then click on... sorry, not account settings. Go to the billing tab first. From there you should see an option to update your payment method.",
  },
  {
    id: 'clip-04',
    text: "I totally understand, and that's... yeah, that's really frustrating, I'm sorry about that. What I can do is issue a refund for the full amount, and that should hit your account in, um, three to five business days. Does that work for you?",
  },
  {
    id: 'clip-05',
    text: "So I'm looking at the notes on your account and it says that. Hang on, let me read this. Okay so it looks like a technician already came out on Thursday but wasn't able to get in. Were you home that day or did they maybe have the wrong, um, the wrong unit number?",
  },
  {
    id: 'clip-06',
    text: 'The good news is your warranty does cover this, so we can get a replacement sent out no problem. I just need to... actually, do you have the serial number handy? It should be on the bottom of the device or on the box if you still have it.',
  },
  {
    id: 'clip-07',
    text: "Hmm, that's interesting. I'm noticing there was a slight delay around the time you submitted it. Oh wait, sorry, I was looking at the wrong timestamp there. Let me switch over to the correct one. Yeah, okay, now I'm seeing it properly. So it looks like the system flagged it automatically, which is probably why you got that notification.",
  },
  {
    id: 'clip-08',
    text: "Alright, let me try searching by your email instead, that might be quicker. Okay, here we go, that pulled it up right away. Yeah, I can see the charge you're talking about. It was authorized but not fully captured, so that's why it might look a little odd on your statement. That actually makes sense given the timing.",
  },
  {
    id: 'clip-09',
    text: "So I can see here that the package was marked as delivered on Tuesday, but if you're saying it never arrived then what we'll do is... let me just. Yeah, I'm going to open a lost package investigation for you. That usually takes about forty-eight hours to resolve.",
  },
  {
    id: 'clip-10',
    text: "Bear with me one second, I'm just waiting for this screen to load. There we go. Okay so it looks like your subscription renewed on the twelfth, which is why you're seeing that charge. Do you want me to cancel it going forward or were you wanting a refund on this one specifically?",
  },
  {
    id: 'clip-11',
    text: "Yeah so the reason you're seeing two charges is because the first one was a pre-authorization and the second one is the actual charge. The pre-auth should drop off in, um, two to three business days. If it doesn't, give us a call back and we'll sort it out.",
  },
  {
    id: 'clip-12',
    text: "I'm going to put you on a brief hold while I check with my supervisor on that. Actually, you know what, let me just look it up myself real quick. Okay yeah, so we can absolutely do that for you, no problem at all.",
  },
  {
    id: 'clip-13',
    text: "So the way the return process works is you'll get an email with a prepaid shipping label, and then you just... you can drop it off at any post office or schedule a pickup. Once we receive it back, the refund goes through automatically. Usually takes about a week from that point.",
  },
  {
    id: 'clip-14',
    text: "Let me pull up the tracking on that. Okay so it left our warehouse on... Monday. And it looks like it's currently sitting at a sorting facility in Memphis. So it hasn't moved since Wednesday, which is, um, not ideal. Let me flag that with our shipping team.",
  },
  {
    id: 'clip-15',
    text: "Right, so I see what happened here. Your old plan was grandfathered in at the lower rate, and when the system updated it... it switched you to the current pricing. That shouldn't have happened. Let me get you back on the original rate.",
  },
  {
    id: 'clip-16',
    text: "I appreciate your patience with this, I know it's been a long call. So just to recap what we've done today. We've issued the refund, we've updated your shipping address, and I've added a note to your account so if this happens again they'll know the context. Sound good?",
  },
  {
    id: 'clip-17',
    text: "Okay I'm looking at your device history and it shows... huh, that's weird. It shows three replacements in the last year. Have you been having ongoing issues with this model or is this a new thing?",
  },
  {
    id: 'clip-18',
    text: "So what I'd recommend is. Let me think about the best way to explain this. Basically your current plan doesn't include international coverage, but we have an add-on that's ten dollars a month that would cover you while you're traveling. Do you want me to add that on temporarily?",
  },
  {
    id: 'clip-19',
    text: "I can see the appointment was scheduled for between two and four, and it looks like the technician arrived at... three forty-seven. So they were within the window, but I understand that's still cutting it close. If you need to reschedule we can definitely find a better time.",
  },
  {
    id: 'clip-20',
    text: "Yeah no, you're absolutely right, that's our mistake. I don't know why it was set up that way. Let me fix that for you right now. Okay, done. You should see that reflected on your next statement. And again, I'm really sorry about the confusion.",
  },
];

export const MODELS_BY_ID = new Map(MODELS.map((model) => [model.id, model]));
export const PROVIDERS_BY_ID = new Map(
  PROVIDERS.map((provider) => [provider.id, provider]),
);
export const VARIANTS_BY_ID = new Map(
  VARIANTS.map((variant) => [variant.id, variant]),
);
export const PROMPTS_BY_ID = new Map(
  PROMPTS.map((prompt) => [prompt.id, prompt]),
);

export const variantsOfModel = (modelId: string): CatalogVariant[] =>
  VARIANTS.filter((variant) => variant.modelId === modelId);

/** Frozen settings-version segment of the clip content hashes. */
const AUDIO_GENERATION_VERSION = 'settings-v3';

const AUDIO_ORIGIN = process.env.HUMANNESS_AUDIO_ORIGIN ?? ARENA_AUDIO_ORIGIN;

/**
 * Hosted clip URL for a (variant, prompt) — the original prototype's exact
 * content-hash scheme, frozen so the hosted clips resolve unchanged.
 */
export const audioUrlFor = (variantId: string, promptId: string): string => {
  const digest = createHash('sha256')
    .update(`${variantId}|${promptId}|${AUDIO_GENERATION_VERSION}`)
    .digest('hex');
  return `${AUDIO_ORIGIN}/audio/${digest.slice(0, 32)}.mp3`;
};
