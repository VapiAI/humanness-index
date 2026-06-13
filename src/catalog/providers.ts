/**
 * The 9 provider entries. ORDER IS FROZEN: it feeds the arena PROVIDERS
 * array in server/catalog.ts, whose order shapes the derived MODELS array
 * (and so the first-paint identity surfaces). Append new providers at the
 * end, before any unlisted ones.
 *
 * Stats provenance: verified against official provider docs/pricing pages as
 * of June 2026 (see each Sourced). Prices are published pay-as-you-go API
 * rates normalized to USD per 1M characters; unsourced prices are omitted
 * and render as a dash.
 */
import type { ProviderEntry } from './types';

export const PROVIDER_ENTRIES: ProviderEntry[] = [
  {
    id: 'elevenlabs',
    slug: 'elevenlabs',
    name: 'ElevenLabs',
    websiteUrl: 'https://elevenlabs.io',
    mark: 'elevenlabs.svg',
    monogram: '11',
    stats: {
      languages: {
        value: 32,
        sourceUrl: 'https://elevenlabs.io/docs/overview/models',
        asOf: '2026-06-10',
        note: 'Low-latency tier default (Turbo/Flash v2.5); Turbo v2 and Flash v2 are English-only, Multilingual v2 lists 29, and Eleven v3 lists 70+, encoded per model.',
      },
      pricing: {
        value: '$50',
        sourceUrl: 'https://elevenlabs.io/pricing/api',
        asOf: '2026-06-10',
        note: 'ElevenAPI pay-as-you-go: Flash/Turbo $0.05 per 1k characters = $50 per 1M. Eleven v3 and Multilingual v2 bill $0.10 per 1k ($100 per 1M), encoded per model.',
      },
    },
    copy: [
      {
        heading: 'About ElevenLabs',
        paragraphs: [
          'ElevenLabs is the incumbent voice platform, with model families that span ultra low latency conversational agents to maximum expressiveness. Latency and language coverage vary sharply across those families, so every ElevenLabs model on the Humanness Index™ carries its own figures rather than one provider-wide number.',
        ],
        sourceUrls: ['https://elevenlabs.io/docs/overview/models'],
      },
      {
        heading: 'Model families and pricing',
        paragraphs: [
          'Six ElevenLabs models sit on the Index, spanning the Turbo, Flash, Multilingual, and v3 families. ElevenLabs bills in credits: Flash and Turbo models bill one credit per two characters, while Eleven v3 and Multilingual v2 bill one credit per character, which is why those two carry a higher effective rate.',
        ],
        sourceUrls: [
          'https://elevenlabs.io/docs/overview/models',
          'https://elevenlabs.io/pricing/api',
        ],
      },
    ],
  },
  {
    id: 'cartesia',
    slug: 'cartesia',
    name: 'Cartesia',
    websiteUrl: 'https://cartesia.ai',
    mark: 'cartesia.png',
    stats: {
      languages: {
        value: 42,
        sourceUrl: 'https://docs.cartesia.ai',
        asOf: '2026-06-10',
        note: 'Sonic 3 and 3.5; earlier Sonic and Sonic 2 shipped 15, encoded per model.',
      },
      pricing: {
        value: '$50',
        sourceUrl: 'https://cartesia.ai/pricing',
        asOf: '2026-06-10',
        note: '1 credit per character (docs.cartesia.ai/pricing); entry self-serve Pro plan is $5/mo for 100K credits, a $50 per 1M effective rate; larger plans drop to $37-39 per 1M. Same credit rate for every Sonic.',
      },
    },
    copy: [
      {
        heading: 'About Cartesia',
        paragraphs: [
          'Cartesia was founded by the researchers who created state space models, the S4 and Mamba architectures from their academic work. Every Sonic generation is a state space model rather than a Transformer, which is the architectural basis of the latency claims the family is known for.',
        ],
        sourceUrls: ['https://cartesia.ai/blog/sonic'],
      },
      {
        heading: 'Platform and compliance',
        paragraphs: [
          'Four Sonic generations sit on the Humanness Index™, from the May 2024 debut model to the current Sonic 3.5 flagship. Since Sonic 3 the platform has carried SOC 2 Type II, HIPAA, and PCI Level 1 compliance, aimed at regulated phone work.',
        ],
        sourceUrls: ['https://docs.cartesia.ai'],
      },
    ],
  },
  {
    id: 'xai',
    slug: 'xai',
    name: 'xAI',
    websiteUrl: 'https://x.ai',
    mark: 'xai.svg',
    monogram: 'xAI',
    stats: {
      languages: {
        value: 20,
        sourceUrl:
          'https://docs.x.ai/developers/model-capabilities/audio/voice',
        asOf: '2026-06-10',
      },
      pricing: {
        value: '$15',
        sourceUrl: 'https://x.ai/news/grok-stt-and-tts-apis',
        asOf: '2026-06-10',
        note: '$15.00 per 1M characters per the launch post (x.ai/api/voice; docs.x.ai/developers/models/text-to-speech). Secondary coverage reported $4.20 per 1M; the launch post figure is used.',
      },
    },
    copy: [
      {
        heading: 'About xAI',
        paragraphs: [
          'xAI built its voice stack fully in house, from voice activity detection to the audio models themselves, for Grok Voice, the assistant that ships on Grok mobile apps, Tesla vehicles, and Starlink customer support. The Grok Voice Agent API opened the stack to developers in December 2025, and standalone TTS and STT APIs followed in April 2026.',
        ],
        sourceUrls: [
          'https://x.ai/news/grok-voice-agent-api',
          'https://x.ai/news/grok-stt-and-tts-apis',
        ],
      },
      {
        heading: 'The Grok voice stack',
        paragraphs: [
          'Grok TTS offers five expressive voices (Ara, Eve, Leo, Rex, and Sal, with Eve as the default) across 20 languages, with inline speech tags like [laugh], [sigh], and [whisper] for delivery control. REST requests accept up to 15,000 characters, and a WebSocket streaming variant accepts unbounded input. Both variants currently sit at the top of the Humanness Index™.',
        ],
        sourceUrls: [
          'https://docs.x.ai/developers/model-capabilities/audio/voice',
        ],
      },
    ],
  },
  {
    id: 'minimax',
    slug: 'minimax',
    name: 'MiniMax',
    websiteUrl: 'https://www.minimax.io',
    mark: 'minimax.svg',
    monogram: 'MM',
    stats: {
      languages: {
        value: 40,
        sourceUrl:
          'https://platform.minimax.io/docs/api-reference/speech-t2a-http',
        asOf: '2026-06-10',
        note: 'Vendor lists 40+ languages for the current speech generation.',
      },
      pricing: {
        value: '$60',
        sourceUrl: 'https://platform.minimax.io/docs/guides/pricing-paygo',
        asOf: '2026-06-10',
        note: 'Speech 2.5 turbo $60 per 1M characters pay-as-you-go; the arena clips are the 2.5 generation, turbo tier (matches the measured realtime latency).',
      },
    },
    copy: [
      {
        heading: 'About MiniMax',
        paragraphs: [
          'MiniMax is the Shanghai AI lab behind the MiniMax speech line, served through its hosted t2a_v2 API with HD and Turbo tiers. It is widely regarded as the strongest text to speech provider for Chinese, and its recent generations brought English accuracy and rhythm up alongside that strength.',
        ],
        sourceUrls: ['https://www.minimax.io/news/minimax-speech-25'],
      },
      {
        heading: 'Speech generations',
        paragraphs: [
          'The speech line moved fast through 2025, with the Speech-02 series arriving in April and Speech 2.5 following in August. The current generation supports more than 40 languages and clones a voice from roughly six to ten seconds of reference audio using a learnable speaker encoder that needs no transcript. The clips on this Index were generated with the Speech 2.5 generation, turbo tier.',
        ],
        sourceUrls: [
          'https://www.minimax.io/news/minimax-speech-25',
          'https://platform.minimax.io/docs/api-reference/speech-t2a-http',
        ],
      },
    ],
  },
  {
    id: 'gradium',
    slug: 'gradium',
    name: 'Gradium',
    websiteUrl: 'https://gradium.ai',
    mark: 'gradium.svg',
    stats: {
      languages: {
        value: 5,
        sourceUrl: 'https://docs.gradium.ai/api-reference/endpoint/tts-post',
        asOf: '2026-06-10',
        note: 'English, French, Spanish, Portuguese, and German.',
      },
      pricing: {
        value: '$58',
        sourceUrl: 'https://gradium.ai/pricing',
        asOf: '2026-06-10',
        note: '1 credit per character (docs.gradium.ai/guides/credits); entry XS plan is $13/mo for 225k credits, a $58 per 1M effective rate.',
      },
    },
    copy: [
      {
        heading: 'About Gradium',
        paragraphs: [
          'Gradium is the commercial company from the founders of Kyutai, the Paris open research lab that shipped the first real time conversational speech model. Founded in September 2025 by generative audio pioneers from Google DeepMind and Meta, it raised a $70M seed led by FirstMark and Eurazeo, with angels including Yann LeCun.',
        ],
        sourceUrls: [
          'https://gradium.ai/blog/gradium',
          'https://slator.com/voice-ai-startup-gradium-70m-seed-round/',
        ],
      },
      {
        heading: 'Production speech APIs',
        paragraphs: [
          'Gradium came out of stealth with production speech APIs in December 2025, built on a decade of generative audio research spanning neural codecs, audio LLMs, and Moshi. Its text to speech streams from servers in Europe and the US, speaks five languages, and clones a voice from a ten second sample.',
        ],
        sourceUrls: ['https://docs.gradium.ai/api-reference/endpoint/tts-post'],
      },
    ],
  },
  {
    id: 'canopylabs',
    slug: 'canopy-labs',
    name: 'Canopy Labs',
    websiteUrl: 'https://canopylabs.ai',
    mark: 'canopy.svg',
    stats: {
      languages: {
        value: 'English',
        sourceUrl: 'https://github.com/canopyai/Orpheus-TTS',
        asOf: '2026-06-10',
        note: 'Flagship trained on English; a multilingual research preview followed in April 2025.',
      },
      pricing: {
        value: 'Open source',
        sourceUrl: 'https://github.com/canopyai/Orpheus-TTS',
        asOf: '2026-06-10',
        note: 'Apache 2.0 code; weights under the Llama 3.2 Community License. No commercial per-character price.',
      },
    },
    copy: [
      {
        heading: 'About Canopy Labs',
        paragraphs: [
          'Canopy Labs is the team behind Orpheus, the open source speech LLM family released in March 2025 under the Apache 2.0 license. The company has promised smaller 1B, 400M, and 150M variants alongside the flagship 3B model, and it partners with managed inference providers such as Baseten for production hosting.',
        ],
        sourceUrls: [
          'https://canopylabs.ai/model-releases',
          'https://www.baseten.co/blog/canopy-labs-selects-baseten-as-preferred-inference-provider-for-orpheus-tts-model/',
        ],
      },
      {
        heading: 'Open weights on the Index',
        paragraphs: [
          'Orpheus is the open weights entry on the Humanness Index™, and it showed that an open model can compete with closed source rivals on prosody and empathy. Teams can self host it or run it through managed providers.',
        ],
        sourceUrls: ['https://github.com/canopyai/Orpheus-TTS'],
      },
    ],
  },
  {
    id: 'inworld',
    slug: 'inworld',
    name: 'Inworld',
    websiteUrl: 'https://inworld.ai',
    mark: 'inworld.png',
    monogram: 'IW',
    stats: {
      languages: {
        value: 15,
        sourceUrl: 'https://docs.inworld.ai/release-notes/tts',
        asOf: '2026-06-10',
        note: 'TTS 1.5 generation; Realtime TTS-2 covers 100+, encoded per model.',
      },
      pricing: {
        value: '$35',
        sourceUrl: 'https://inworld.ai/pricing',
        asOf: '2026-06-10',
        note: 'On-demand rates: TTS 1.5 Max $35 per 1M characters; TTS-2 $25 per 1M, encoded per model.',
      },
    },
    copy: [
      {
        heading: 'About Inworld',
        paragraphs: [
          'Inworld builds voice models for interactive agents, and its TTS line climbed third party speech arenas through 2025, with the 1.5 generation reaching the top of the Artificial Analysis Speech Arena ahead of Google and ElevenLabs. Integration partners for its realtime models include Vapi.',
        ],
        sourceUrls: ['https://inworld.ai/blog/realtime-tts-2'],
      },
      {
        heading: 'Model line',
        paragraphs: [
          'The 1.5 generation targets the quality and speed balance most production agents need, with a mini sibling for the lowest latency. Realtime TTS-2, released as a research preview in May 2026, conditions on the audio of prior conversation turns and holds a single voice identity across more than 100 languages.',
        ],
        sourceUrls: ['https://docs.inworld.ai/release-notes/tts'],
      },
    ],
  },
  {
    id: 'smallestai',
    slug: 'smallest-ai',
    name: 'Smallest.ai',
    websiteUrl: 'https://smallest.ai',
    mark: 'smallestai.png',
    stats: {
      languages: {
        value: 12,
        sourceUrl:
          'https://docs.smallest.ai/waves/model-cards/text-to-speech/lightning-v-3-1',
        asOf: '2026-06-12',
        note: 'Lightning v3.1 model card: 12 languages with auto-detection and code-switching; the Lightning V3 launch post lists 15 including major European languages.',
      },
      pricing: {
        value: '$15',
        sourceUrl: 'https://smallest.ai/pricing',
        asOf: '2026-06-12',
        note: 'Lightning V3.1 pay-as-you-go at ~$0.0145 per 1k characters = $14.50 per 1M; the Lightning V3.1 Pro tier bills ~$0.0195 per 1k ($19.50 per 1M).',
      },
    },
    copy: [
      {
        heading: 'About Smallest.ai',
        paragraphs: [
          'Smallest.ai is a research-first voice AI company whose Waves platform spans the Lightning text to speech line, the Pulse speech to text models, and the Atoms voice agent stack. Its March 2026 Lightning V3 launch claimed blind listener wins over OpenAI, Cartesia, and ElevenLabs on the EmergentTTS benchmark, positioning the family squarely at conversational agents.',
        ],
        sourceUrls: [
          'https://smallest.ai/blog/introducing-lightning-v3',
          'https://docs.smallest.ai/waves/model-cards/text-to-speech/lightning-v-3-1',
        ],
      },
      {
        heading: 'Platform and pricing',
        paragraphs: [
          'One Lightning model sits on the Index, served through the unified Waves API with HTTP, SSE, and WebSocket access and instant voice cloning from a 5 to 15 second sample via API or console. Pay-as-you-go usage bills about $0.0145 per 1,000 characters, a $14.50 per 1M effective rate, with custom enterprise and on premises options above it.',
        ],
        sourceUrls: [
          'https://smallest.ai/pricing',
          'https://docs.smallest.ai/waves/documentation/voice-cloning/instant-clone-api',
        ],
      },
    ],
  },
  {
    id: 'neuphonic',
    slug: 'neuphonic',
    name: 'Neuphonic',
    websiteUrl: 'https://neuphonic.com',
    mark: 'neuphonic.png',
    stats: {
      languages: {
        value: 9,
        sourceUrl: 'https://docs.neuphonic.com/build-group/languages',
        asOf: '2026-06-12',
        note: 'English, Chinese, French, German, Japanese, Korean, Spanish, Portuguese, and Urdu.',
      },
      // No published per-character API pricing as of 2026-06-12 (plans sit
      // behind the app); omitted, renders as a dash.
    },
    copy: [
      {
        heading: 'About Neuphonic',
        paragraphs: [
          'Neuphonic is a London voice AI startup founded in 2024 by Jiameng Gao and Sohaib Ahmad, focused on low latency text to speech APIs and on-device voice. It raised a 3M pound pre-seed in October 2024 on the back of a closed beta, and alongside the hosted API it publishes the open source NeuTTS family of on-device speech models with instant cloning.',
        ],
        sourceUrls: [
          'https://www.thesaasnews.com/news/neuphonic-secures-3m-in-pre-seed-funding/',
          'https://github.com/neuphonic/neutts',
        ],
      },
      {
        heading: 'Platform',
        paragraphs: [
          'The hosted API streams over SSE and WebSockets with a per-request language code across nine languages, clones a voice from a short clean sample, and layers a conversational agents product on top. Neuphonic marked version 1.0.0 of the API in August 2025.',
        ],
        sourceUrls: [
          'https://docs.neuphonic.com/build-group/text-to-speech',
          'https://docs.neuphonic.com/changelog',
        ],
      },
    ],
  },
  // Providers whose only models are unannounced live in the private registry
  // overlay (catalog/overlay.local.ts, see SPEC 4.3) and append here, last,
  // when their models go public.
];
