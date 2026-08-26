/**
 * The 24 model entries (22 active in the arena; ElevenLabs Multilingual v2
 * and Turbo v2.5 are retired but keep their pages).
 *
 * ADD A NEW MODEL CHECKLIST (the whole point of this registry):
 *  1. Generate + host the model's audio clips (each source voice x 20
 *     prompts, the frozen content-hashing scheme in
 *     server/catalog.ts#audioUrlFor) on the arena audio origin.
 *  2. Add ONE entry below (and one in providers.ts + a mark file under
 *     public/marks if it is a new provider). Include:
 *       - id (frozen, matches the store), slug (frozen, clean URL segment),
 *         arenaApiId (frozen forever: it feeds variant ids + audio hashes),
 *       - status 'active', a unique voiceProfile seed,
 *       - sample.fallbackClip (compiler-enforced for active entries: the
 *         pinned offline clip for the Listen button; use the pinnedClip()
 *         helper from catalog/audio.ts),
 *       - sourced stats (latencyMs measured-only or null, languages,
 *         pricing) and releaseDate,
 *       - >=2 copy blocks + FAQ entries (no em dashes anywhere in copy).
 *  3. Verify the hosted clips actually resolve (network check the type
 *     system cannot do):
 *       bun run humanness:verify-clips <id|slug>
 *     (pipeline/verifyClips.ts; generate + upload the clips first with
 *      `bun run humanness:clips <id> --upload` — see pipeline/RUNBOOK.md)
 *  4. Bump the pinned counts in catalog.test.ts (intentional-change guard);
 *     `bun test` then enforces everything else
 *     (unique ids/slugs/voiceProfile, provider ref, sourced provenance,
 *     fallback-clip hash equality, copy lint).
 *  5. Optional: a seed row in server/seed-standings.json + seedLikelyRank
 *     here for the first-paint table; without one the model starts at
 *     Elo 1200 once live votes arrive and joins the table on first fetch.
 *  Battles/samples, leaderboard merge, stats, detail pages, sitemap, and
 *  internal links all derive from this entry. Nothing else to edit.
 *
 * ORDER IS FROZEN: entries are grouped by provider in providers.ts order,
 * and within-provider order feeds the derived MODELS array in
 * server/catalog.ts (identity surfaces + equality tests). Append new models
 * at the end of their provider group; keep unlisted entries last.
 *
 * Latency provenance (measured-only, hard rule): median of 50 sequential
 * live streaming trials per model (June 2026) against each provider's
 * streaming API (WebSocket where offered; Eleven v3 and MiniMax stream over
 * HTTP), fixed 12-word prompt, timed from request send on a pre-established
 * connection to the first audio chunk. Includes network RTT from the
 * benchmark machine, so the relative ordering is the robust signal. Script +
 * raw trials: src/pipeline/ (ttfbBench.ts and its results convention).
 * Models with `latencyMs: null` have no
 * reachable API to measure (Orpheus has no hosted API) and display a dash;
 * we never show vendor estimates. The two Grok configs share one WS API and
 * differ only by the optimize_streaming_latency flag, so each is measured
 * with its own flag state. Gradium carries a team-reported measurement
 * (see teamReportedTtfb).
 */
import { pinnedClip as clip } from './audio';
import type { FaqEntry, ModelEntry, Sourced } from './types';

/** The original prototype's 50-trial run (June 2026), same artifact convention. */
const TTFB_BENCHMARK_SOURCE =
  'src/pipeline/results/ttfb_results_50trial.json';
/** The in-repo pipeline port of the same 50-trial protocol (June 2026 runs). */
const PIPELINE_TTFB_SOURCE =
  'src/pipeline/results/ttfb_results_50trial.json';

const measuredTtfb = (value: number, note?: string): Sourced<number> => ({
  value,
  sourceUrl: TTFB_BENCHMARK_SOURCE,
  asOf: '2026-06-10',
  note:
    note ??
    'Median of 50 sequential live streaming trials, June 2026; includes network RTT from the benchmark machine.',
});

/** Same 50-trial protocol, run by pipeline/ttfbBench.ts (the TS port). */
const pipelineTtfb = (
  value: number,
  note?: string,
  asOf = '2026-06-11',
): Sourced<number> => ({
  value,
  sourceUrl: PIPELINE_TTFB_SOURCE,
  asOf,
  note:
    note ??
    'Median of 50 sequential live streaming trials, June 2026; includes network RTT from the benchmark machine.',
});

/**
 * A first-party measurement reported directly by the Vapi team where the
 * 50-trial pipeline could not run (e.g. no API key on the benchmark
 * machine). Still measured, never a vendor estimate; replace with a
 * pipelineTtfb() run when credentials arrive.
 */
const teamReportedTtfb = (value: number, asOf: string): Sourced<number> => ({
  value,
  sourceUrl: `team-reported/${asOf}`,
  asOf,
  confidence: 'medium',
  note: 'Measured and reported by the Vapi team; not yet reproduced by the in-repo 50 trial pipeline.',
});

const HOW_TESTED = (name: string): FaqEntry => ({
  question: `How is ${name} tested on the Humanness Index™?`,
  answer: `Listeners hear ${name} against another model in a blind head to head round, both voices reading the same customer support prompt from the same cloned source voice, and they pick whichever sounds more human. Its Humanness score derives purely from those votes.`,
});

export const MODEL_ENTRIES: ModelEntry[] = [
  /* ------------------------------ ElevenLabs ------------------------------ */
  {
    id: 'elevenlabs-turbo-v2',
    slug: 'elevenlabs-turbo-v2',
    providerId: 'elevenlabs',
    name: 'Turbo v2',
    apiModelId: 'eleven_turbo_v2',
    arenaApiId: 'eleven_turbo_v2',
    status: 'active',
    releaseDate: {
      value: '2023',
      sourceUrl: 'https://elevenlabs.io/docs/overview/models',
      asOf: '2026-06-10',
      confidence: 'medium',
      note: 'Late 2023; ElevenLabs published no exact date.',
    },
    stats: {
      latencyMs: measuredTtfb(302),
      languages: {
        value: 'English',
        sourceUrl: 'https://elevenlabs.io/docs/overview/models',
        asOf: '2026-06-10',
      },
    },
    voiceProfile: 10,
    seedLikelyRank: '#6-13',
    sample: {
      fallbackClip: clip(
        'voice-clara',
        'elevenlabs',
        'eleven_turbo_v2',
        'clip-12',
        'd2b6c584ade8f672fb8c39a0b90bb370',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Turbo v2 was ElevenLabs' first generation low latency model, an English only engine built to bring conversational agents under a latency bar its earlier models could not meet. ElevenLabs now recommends the Flash family for new builds and describes Turbo v2 as functionally equivalent to Flash v2 but slower on average. It remains widely deployed in voice stacks built before Flash arrived, and it still posts a strong humanness showing on the Index.",
        ],
        sourceUrls: ['https://elevenlabs.io/docs/overview/models'],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'Released in late 2023, Turbo v2 defined the first generation of the low latency tier ElevenLabs later rebuilt as Flash. In our 50 trial streaming benchmark it returned first audio in a median of 302 ms, the slowest of the four low latency ElevenLabs models on the Index.',
        ],
        sourceUrls: ['https://elevenlabs.io/docs/overview/models'],
      },
    ],
    faq: [
      HOW_TESTED('Turbo v2'),
      {
        question: 'Which languages does Turbo v2 support?',
        answer:
          'Turbo v2 is English only. Its successor Turbo v2.5 extended the same latency tier to 32 languages.',
      },
    ],
  },
  {
    id: 'elevenlabs-turbo-v25',
    slug: 'elevenlabs-turbo-v2-5',
    providerId: 'elevenlabs',
    name: 'Turbo v2.5',
    apiModelId: 'eleven_turbo_v2_5',
    arenaApiId: 'eleven_turbo_v2_5',
    // Retired 2026-07-23 (PRO-3580): trims the ElevenLabs entries in the
    // arena to one per active family. Page and hosted clips stay live.
    status: 'retired',
    releaseDate: {
      value: '2024-07-19',
      sourceUrl: 'https://elevenlabs.io/blog/introducing-turbo-v25',
      asOf: '2026-06-10',
    },
    stats: {
      latencyMs: measuredTtfb(265),
    },
    voiceProfile: 5,
    seedLikelyRank: '#3-12',
    sample: {
      fallbackClip: clip(
        'voice-nelliot',
        'elevenlabs',
        'eleven_turbo_v2_5',
        'clip-15',
        '608d4f25e3e434a7f8ac23fb8e53a8f6',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Turbo v2.5 arrived in July 2024 and extended ElevenLabs' low latency tier from English to 32 languages, making Hindi, French, Spanish, Mandarin and more roughly three times faster than before, with English itself about 25 percent faster. ElevenLabs has since positioned Flash v2.5 as its successor. It was the strongest ElevenLabs model in blind listening tests while it competed on the Humanness Index™, and it is now retired from the arena in favor of one entry per active family.",
        ],
        sourceUrls: ['https://elevenlabs.io/blog/introducing-turbo-v25'],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'Turbo v2.5 brought 32 languages to the low latency tier when it launched in July 2024. In our 50 trial streaming benchmark it returned first audio in a median of 265 ms.',
        ],
        sourceUrls: ['https://elevenlabs.io/docs/overview/models'],
      },
    ],
    faq: [
      HOW_TESTED('Turbo v2.5'),
      {
        question: 'How does Turbo v2.5 compare to Flash v2.5?',
        answer:
          'Flash v2.5 is faster in our measurements (197 ms vs 265 ms median TTFB) and ElevenLabs recommends Flash for new real time builds, but Turbo v2.5 posted the stronger humanness showing in blind tests while it competed.',
      },
    ],
  },
  {
    id: 'elevenlabs-flash-v2',
    slug: 'elevenlabs-flash-v2',
    providerId: 'elevenlabs',
    name: 'Flash v2',
    apiModelId: 'eleven_flash_v2',
    arenaApiId: 'eleven_flash_v2',
    status: 'active',
    releaseDate: {
      value: '2024-12-18',
      sourceUrl: 'https://elevenlabs.io/blog/meet-flash',
      asOf: '2026-06-10',
    },
    stats: {
      latencyMs: measuredTtfb(226),
      languages: {
        value: 'English',
        sourceUrl: 'https://elevenlabs.io/docs/overview/models',
        asOf: '2026-06-10',
      },
    },
    voiceProfile: 9,
    seedLikelyRank: '#5-13',
    sample: {
      fallbackClip: clip(
        'voice-emma',
        'elevenlabs',
        'eleven_flash_v2',
        'clip-10',
        '5fcb0036bbfd5aedf5c1e5406114edfe',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Flash v2 is ElevenLabs' ultra low latency English model, announced in December 2024 with speech generation around 75 ms plus network overhead. It trades a little of the Turbo family's expressiveness for speed, and ElevenLabs recommends it for real time conversational agents that only need English.",
        ],
        sourceUrls: ['https://elevenlabs.io/blog/meet-flash'],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'Flash v2 is the fastest English path on the ElevenLabs platform. In our 50 trial streaming benchmark it returned first audio in a median of 226 ms including network time from the benchmark machine.',
        ],
        sourceUrls: ['https://elevenlabs.io/docs/overview/models'],
      },
    ],
    faq: [
      HOW_TESTED('Flash v2'),
      {
        question: 'What latency does Flash v2 have?',
        answer:
          'ElevenLabs publishes roughly 75 ms generation time. In our own 50 trial streaming benchmark, which includes network time from the benchmark machine, Flash v2 returned first audio in a median of 226 ms.',
      },
    ],
  },
  {
    id: 'elevenlabs-flash-v25',
    slug: 'elevenlabs-flash-v2-5',
    providerId: 'elevenlabs',
    name: 'Flash v2.5',
    apiModelId: 'eleven_flash_v2_5',
    arenaApiId: 'eleven_flash_v2_5',
    status: 'active',
    releaseDate: {
      value: '2024-12-18',
      sourceUrl: 'https://elevenlabs.io/blog/meet-flash',
      asOf: '2026-06-10',
    },
    stats: {
      latencyMs: measuredTtfb(197),
    },
    voiceProfile: 7,
    seedLikelyRank: '#3-13',
    sample: {
      // The arena's original flash-v2.5 fallback clip was a retired
      // voice-elliot variant; re-pinned to the active Clara variant.
      fallbackClip: clip(
        'voice-clara',
        'elevenlabs',
        'eleven_flash_v2_5',
        'clip-20',
        '6fc0da8bb9689e1cdbdaa63c5fce6ebf',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Flash v2.5 is the multilingual member of ElevenLabs' fastest family, generating speech in about 75 ms across 32 languages. Announced in December 2024, it is the model ElevenLabs recommends for real time agents beyond English, and it bills at half the credit cost per character of the flagship v3. That mix makes it the default choice for latency sensitive, cost sensitive voice deployments on the ElevenLabs platform.",
        ],
        sourceUrls: ['https://elevenlabs.io/blog/meet-flash'],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'Flash v2.5 pairs the Flash latency tier with 32 languages. In our 50 trial streaming benchmark it returned first audio in a median of 197 ms, the fastest ElevenLabs result on the Index.',
        ],
        sourceUrls: ['https://elevenlabs.io/docs/overview/models'],
      },
    ],
    faq: [
      HOW_TESTED('Flash v2.5'),
      {
        question: 'Which languages does Flash v2.5 support?',
        answer:
          'Flash v2.5 generates speech in 32 languages, making it the multilingual member of the fastest ElevenLabs family. The English only sibling is Flash v2.',
      },
    ],
  },
  {
    id: 'elevenlabs-eleven-v3',
    slug: 'elevenlabs-eleven-v3',
    providerId: 'elevenlabs',
    name: 'Eleven v3',
    apiModelId: 'eleven_v3',
    arenaApiId: 'eleven_v3',
    status: 'active',
    releaseDate: {
      value: '2026-03-14',
      sourceUrl: 'https://elevenlabs.io/blog/eleven-v3',
      asOf: '2026-06-10',
      note: 'General availability; alpha launched 2025-06-03.',
    },
    stats: {
      latencyMs: measuredTtfb(758),
      languages: {
        value: '70+',
        sourceUrl: 'https://elevenlabs.io/docs/overview/models',
        asOf: '2026-06-10',
        note: '74 languages listed.',
      },
      pricing: {
        value: '$100',
        sourceUrl: 'https://elevenlabs.io/pricing/api',
        asOf: '2026-06-10',
        note: 'Bills at the Multilingual v2 / v3 ElevenAPI rate: $0.10 per 1k characters = $100 per 1M.',
      },
    },
    voiceProfile: 6,
    seedLikelyRank: '#3-13',
    sample: {
      fallbackClip: clip(
        'voice-nelliot',
        'elevenlabs',
        'eleven_v3',
        'clip-02',
        '7dfe588aaaec8fb66d0b14bf5b70ef57',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Eleven v3 is ElevenLabs' flagship expressive model, launched in alpha in June 2025 and generally available since March 2026. It supports more than 70 languages, multi speaker dialogue, and inline audio tags like [whispers] and [laughs] that direct emotion and delivery. ElevenLabs itself does not recommend v3 for real time conversation because of its higher latency, which makes its blind test scores here an interesting comparison against the faster models it sells alongside.",
        ],
        sourceUrls: [
          'https://elevenlabs.io/blog/eleven-v3',
          'https://help.elevenlabs.io/hc/en-us/articles/35869054119057-What-is-Eleven-v3',
        ],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'v3 is built for expressiveness first: audio tags, dialogue mode, and the widest language coverage on the ElevenLabs platform. In our 50 trial streaming benchmark it returned first audio in a median of 758 ms, well above every realtime model on the Index.',
        ],
        sourceUrls: ['https://elevenlabs.io/docs/overview/models'],
      },
    ],
    faq: [
      HOW_TESTED('Eleven v3'),
      {
        question: 'Why is Eleven v3 slower than other ElevenLabs models?',
        answer:
          'v3 is built for expressiveness rather than real time conversation, with audio tags and multi speaker dialogue. ElevenLabs itself does not recommend it for real time agents; we measured a 758 ms median TTFB, well above every realtime model on the Index.',
      },
    ],
  },

  {
    id: 'elevenlabs-multilingual-v2',
    slug: 'elevenlabs-multilingual-v2',
    providerId: 'elevenlabs',
    name: 'Multilingual v2',
    apiModelId: 'eleven_multilingual_v2',
    arenaApiId: 'eleven_multilingual_v2',
    // Retired 2026-07-23 (PRO-3580): trims the ElevenLabs entries in the
    // arena to one per active family. Page and hosted clips stay live.
    status: 'retired',
    releaseDate: {
      value: '2023-08-22',
      sourceUrl:
        'https://techcrunch.com/2023/08/22/elevenlabs-voice-generating-tools-launch-out-of-beta/',
      asOf: '2026-06-11',
      note: 'Launched alongside the ElevenLabs beta exit; the model docs publish no exact date.',
    },
    stats: {
      latencyMs: pipelineTtfb(
        1006,
        'Measured on the chunked HTTP /stream endpoint (the realtime stream-input WebSocket rejects non-realtime models); median of 50 sequential trials, June 2026, including network RTT.',
      ),
      languages: {
        value: 29,
        sourceUrl: 'https://elevenlabs.io/docs/overview/models',
        asOf: '2026-06-11',
      },
      pricing: {
        value: '$100',
        sourceUrl: 'https://elevenlabs.io/pricing/api',
        asOf: '2026-06-11',
        note: 'Bills at the Multilingual v2 / v3 ElevenAPI rate: $0.10 per 1k characters = $100 per 1M.',
      },
    },
    voiceProfile: 19,
    sample: {
      fallbackClip: clip(
        'voice-emma',
        'elevenlabs',
        'eleven_multilingual_v2',
        'clip-10',
        'dc7491d451f44553a9ad26f0c707436d',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          'Multilingual v2 is the long standing ElevenLabs quality flagship, launched in August 2023 as the model that took the platform out of beta and extended its voices from English to 29 languages. ElevenLabs still describes it as its most lifelike model with rich emotional expression, and it remains the default recommendation for narration, audiobooks, and other pre rendered work where fidelity matters more than speed.',
        ],
        sourceUrls: [
          'https://elevenlabs.io/docs/overview/models',
          'https://techcrunch.com/2023/08/22/elevenlabs-voice-generating-tools-launch-out-of-beta/',
        ],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'The quality counterpart to the realtime Turbo and Flash families: on the independent Coval benchmark it posts the best word error rate of any ElevenLabs model (3.9 percent) but batch class latency. Our own 50 trial benchmark measured a median of 1006 ms to first audio on its chunked HTTP streaming endpoint, the highest on the Index, which is why it competes here on humanness rather than speed.',
        ],
        sourceUrls: [
          'https://benchmarks.coval.ai',
          'https://elevenlabs.io/docs/overview/models',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Multilingual v2'),
      {
        question: 'Why use Multilingual v2 over Flash or Turbo?',
        answer:
          'Quality over latency. Multilingual v2 is tuned for lifelike, emotionally rich output and posts the best word error rate of any ElevenLabs model on the independent Coval benchmark, but we measured a 1006 ms median time to first audio. Real time agents should look at the Flash and Turbo families; narration and pre rendered audio is where Multilingual v2 fits.',
      },
    ],
  },

  /* ------------------------------- Cartesia ------------------------------- */
  {
    id: 'cartesia-sonic',
    slug: 'cartesia-sonic',
    providerId: 'cartesia',
    name: 'Sonic',
    apiModelId: 'sonic',
    arenaApiId: 'sonic',
    status: 'active',
    releaseDate: {
      value: '2024-05',
      sourceUrl: 'https://cartesia.ai/blog/sonic',
      asOf: '2026-06-10',
    },
    stats: {
      latencyMs: measuredTtfb(116),
      languages: {
        value: 15,
        sourceUrl:
          'https://docs.cartesia.ai/build-with-cartesia/tts-models/latest',
        asOf: '2026-06-10',
      },
    },
    voiceProfile: 18,
    seedLikelyRank: '#16',
    sample: {
      fallbackClip: clip(
        'voice-emma',
        'cartesia',
        'sonic',
        'clip-07',
        'b7faecc06a45e5b2458ba62e292a4cbb',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Sonic was Cartesia's debut voice model, released in May 2024 as the first text to speech engine built on the state space model architecture its founders pioneered in academia. At launch it generated lifelike speech with 135 ms model latency, the fastest in its class at the time, with instant voice cloning and speed and emotion controls. Three newer Sonic generations have since superseded it, but it remains the baseline that started Cartesia's run at real time voice.",
        ],
        sourceUrls: ['https://cartesia.ai/blog/sonic'],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'The first SSM voice model, with instant cloning and 15 languages. In our 50 trial streaming benchmark it returned first audio in a median of 116 ms, still among the fastest results on the Index.',
        ],
        sourceUrls: [
          'https://docs.cartesia.ai/build-with-cartesia/tts-models/latest',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Sonic'),
      {
        question: "Is Sonic still Cartesia's current model?",
        answer:
          'No. Newer generations have superseded it, with Sonic 3.6 as the current flagship. Sonic remains in the arena as the baseline of the family.',
      },
    ],
  },
  {
    id: 'cartesia-sonic-2',
    slug: 'cartesia-sonic-2',
    providerId: 'cartesia',
    name: 'Sonic 2',
    apiModelId: 'sonic-2',
    arenaApiId: 'sonic-2',
    status: 'active',
    releaseDate: {
      value: '2025-03',
      sourceUrl: 'https://cartesia.ai/blog/sonic',
      asOf: '2026-06-10',
      confidence: 'medium',
      note: 'Announced alongside the $64M Series A in early 2025.',
    },
    stats: {
      latencyMs: measuredTtfb(159),
      languages: {
        value: 15,
        sourceUrl:
          'https://docs.cartesia.ai/build-with-cartesia/tts-models/latest',
        asOf: '2026-06-10',
      },
    },
    voiceProfile: 15,
    seedLikelyRank: '#11-14',
    sample: {
      fallbackClip: clip(
        'voice-godfrey',
        'cartesia',
        'sonic-2',
        'clip-18',
        'fefa395f6c226030117f7644831e9697',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Sonic 2 was Cartesia's second generation voice model, announced in early 2025 alongside the company's $64M Series A. It cut time to first audio to roughly 90 ms, added a Turbo variant that reached 40 ms, and supported 15 languages. It established Sonic as one of the fastest production text to speech APIs before Sonic 3 took over as the flagship.",
        ],
        sourceUrls: ['https://cartesia.ai/blog/sonic'],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'The fastest production TTS of its moment, with a 40 ms Turbo variant. In our 50 trial streaming benchmark Sonic 2 returned first audio in a median of 159 ms including network time.',
        ],
        sourceUrls: [
          'https://docs.cartesia.ai/build-with-cartesia/tts-models/latest',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Sonic 2'),
      {
        question: 'What latency does Sonic 2 have?',
        answer:
          'Cartesia published roughly 90 ms time to first audio at launch, with a 40 ms Turbo variant. In our 50 trial streaming benchmark it returned first audio in a median of 159 ms including network time.',
      },
    ],
  },
  {
    id: 'cartesia-sonic-3',
    slug: 'cartesia-sonic-3',
    providerId: 'cartesia',
    name: 'Sonic 3',
    apiModelId: 'sonic-3',
    arenaApiId: 'sonic-3',
    status: 'active',
    releaseDate: {
      value: '2025-10-27',
      sourceUrl: 'https://vapi.ai/blog/Cartesia-free-sonic-3-TTS',
      asOf: '2026-06-10',
    },
    stats: {
      latencyMs: measuredTtfb(166),
      voiceCloning: {
        value: 'instant, about 10 s of audio',
        sourceUrl:
          'https://docs.cartesia.ai/build-with-cartesia/tts-models/latest',
        asOf: '2026-06-10',
      },
    },
    voiceProfile: 17,
    seedLikelyRank: '#15-16',
    sample: {
      fallbackClip: clip(
        'voice-emma',
        'cartesia',
        'sonic-3',
        'clip-11',
        '55495aa7b48c8269e33aed90200103ea',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Sonic 3 landed in October 2025 as a major step for Cartesia's state space model architecture. It brought sub 100 ms latency, expanded coverage from 15 to 42 languages including nine Indian languages, and added expressive controls for emotion and even laughter. Instant voice cloning works from about 10 seconds of audio, and the model ships with SOC 2, HIPAA, and PCI compliance for regulated phone work.",
        ],
        sourceUrls: [
          'https://cartesia.ai/blog/sonic',
          'https://vapi.ai/blog/Cartesia-free-sonic-3-TTS',
        ],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'Emotion and laughter tags, 42 languages, and 10 second cloning. In our 50 trial streaming benchmark Sonic 3 returned first audio in a median of 166 ms including network time.',
        ],
        sourceUrls: [
          'https://docs.cartesia.ai/build-with-cartesia/tts-models/latest',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Sonic 3'),
      {
        question: 'Which languages does Sonic 3 support?',
        answer:
          "Sonic 3 expanded Cartesia's coverage from 15 to 42 languages, including nine Indian languages.",
      },
    ],
  },
  {
    id: 'cartesia-sonic-35',
    slug: 'cartesia-sonic-3-5',
    providerId: 'cartesia',
    name: 'Sonic 3.5',
    apiModelId: 'sonic-3.5-2026-05-04',
    arenaApiId: 'sonic-3.5-2026-05-04',
    status: 'active',
    releaseDate: {
      value: '2026-05-04',
      sourceUrl:
        'https://docs.cartesia.ai/build-with-cartesia/tts-models/latest',
      asOf: '2026-06-10',
      note: 'Snapshot release.',
    },
    stats: {
      latencyMs: measuredTtfb(128),
    },
    voiceProfile: 3,
    seedLikelyRank: '#3-10',
    sample: {
      fallbackClip: clip(
        'voice-emma',
        'cartesia',
        'sonic-3.5-2026-05-04',
        'clip-20',
        '3e36a1883267dd73b9e11f42b78ede03',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Sonic 3.5 is the May 2026 Sonic snapshot, and was Cartesia's flagship until Sonic 3.6 shipped in August 2026. Cartesia positioned it as its most natural and fastest model at release, with sub 90 ms latency and native support for 42 languages. It is tuned for production agent transcripts: it reads order numbers, emails, and confirmation codes correctly without preprocessing, and it resolves heteronyms like read and bow from the surrounding words.",
        ],
        sourceUrls: [
          'https://docs.cartesia.ai/build-with-cartesia/tts-models/latest',
        ],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'Alphanumerics and heteronyms without preprocessing, 42 languages, and a published sub 90 ms latency claim. In our 50 trial streaming benchmark it returned first audio in a median of 128 ms, the fastest measured time among current generation models on the Index.',
        ],
        sourceUrls: [
          'https://docs.cartesia.ai/build-with-cartesia/tts-models/latest',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Sonic 3.5'),
      {
        question: 'How fast is Sonic 3.5?',
        answer:
          'Cartesia publishes sub 90 ms latency. In our 50 trial streaming benchmark it returned first audio in a median of 128 ms including network time from the benchmark machine.',
      },
    ],
  },

  /* --------------------------------- xAI ---------------------------------- */
  {
    id: 'xai-xai-tts',
    slug: 'grok-tts',
    providerId: 'xai',
    name: 'Grok TTS',
    // Public product naming is Grok; the arena api id and frontend id stay
    // frozen (they feed variant ids and audio content hashes). The vendor
    // console model id is unverified, so it mirrors the arena id for now.
    apiModelId: 'xai-tts',
    arenaApiId: 'xai-tts',
    status: 'active',
    releaseDate: {
      value: '2026-04-17',
      sourceUrl: 'https://x.ai/news/grok-stt-and-tts-apis',
      asOf: '2026-06-10',
      note: 'Standalone TTS API GA; the Grok Voice stack has been public since 2025-12-17.',
    },
    stats: {
      // The native HTTP POST /v1/audio/speech stays 403 team-gated for our
      // key, so this is measured on the WS API the two Grok configs share;
      // they differ only by the optimize_streaming_latency flag (per the
      // team, 2026-06-12) and this one runs with the flag DISABLED.
      latencyMs: pipelineTtfb(
        460,
        'Median of 50 sequential live WS trials with optimize_streaming_latency disabled (the flag is the only difference from the Streaming config), June 2026; includes network RTT.',
      ),
    },
    voiceProfile: 1,
    seedLikelyRank: '#1-2',
    sample: {
      fallbackClip: clip(
        'voice-godfrey',
        'xai',
        'xai-tts',
        'clip-02',
        '9c2467b7f0aac8f83b3295d49fcb0dac',
      ),
    },
    featuredBlurb:
      "xAI's TTS is the voice to beat for naturalness. In blind, side-by-side comparisons, listeners pick it as the more human-sounding option more often than any other model on the Index, and it holds that edge at phone quality, where most voices start to sound synthetic. For teams where sounding human is the whole point, it's where we'd start.",
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          'Grok TTS is the text to speech model behind Grok Voice, the assistant that ships on Grok mobile apps, Tesla vehicles, and Starlink customer support. xAI built the stack in house, from voice activity detection to the audio models themselves, and opened it to developers through the Grok Voice Agent API in December 2025 and a standalone TTS API in April 2026. The API offers five expressive voices across 20 languages, with inline speech tags like [laugh] and [whisper] for fine grained delivery control. On the Humanness Index™ it is the voice to beat: listeners pick it as the more human option more often than any other model in the field.',
        ],
        sourceUrls: [
          'https://x.ai/news/grok-voice-agent-api',
          'https://x.ai/news/grok-stt-and-tts-apis',
        ],
      },
      {
        heading: 'Release history',
        paragraphs: [
          'The Grok Voice stack went public in December 2025 with the Grok Voice Agent API at $0.05 per minute. The standalone TTS API reached general availability on April 17, 2026 at a flat $15.00 per 1M characters, with REST requests accepting up to 15,000 characters.',
        ],
        sourceUrls: [
          'https://docs.x.ai/developers/model-capabilities/audio/voice',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Grok TTS'),
      {
        question: 'What latency does Grok TTS have?',
        answer:
          'We measured a 460 ms median time to first audio over 50 live trials in June 2026. The two Grok entries share one WebSocket API and differ only by the optimize_streaming_latency flag; Grok TTS is measured with the flag disabled, and the Streaming entry, measured with it enabled, returned 285 ms.',
      },
    ],
  },
  {
    id: 'xai-streaming',
    slug: 'grok-tts-streaming',
    providerId: 'xai',
    name: 'Grok TTS (Streaming)',
    // Same frozen-id note as Grok TTS: 'streaming' is the arena's api id for
    // the WebSocket variant and feeds the audio hashes.
    apiModelId: 'streaming',
    arenaApiId: 'streaming',
    status: 'active',
    releaseDate: {
      value: '2026-04-17',
      sourceUrl: 'https://x.ai/news/grok-stt-and-tts-apis',
      asOf: '2026-06-10',
      note: 'Same stack as the REST TTS API; WebSocket variant.',
    },
    stats: {
      // Measured 2026-06-12 on the model's native realtime WS
      // (wss://api.x.ai/v1/tts) via pipeline/transports/xai.ts: 50 clean
      // trials, zero errors (p90 377 / min 233 / max 390 / stdev 47).
      latencyMs: pipelineTtfb(285),
      streaming: {
        value: true,
        sourceUrl:
          'https://docs.x.ai/developers/model-capabilities/audio/voice',
        asOf: '2026-06-10',
        note: 'WebSocket transport with no input length limit.',
      },
    },
    voiceProfile: 2,
    seedLikelyRank: '#1-2',
    sample: {
      fallbackClip: clip(
        'voice-clara',
        'xai',
        'streaming',
        'clip-20',
        '5a91b97f362092fba1facf712e1a4bcd',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Streaming is the WebSocket variant of xAI's Grok TTS, built for real time agents that need audio flowing before the full input has been processed. It accepts unbounded text over a persistent connection and begins returning audio immediately, which makes it the natural fit for live voice applications. It shares the Grok Voice stack and its five expressive voices, and it ranks alongside its REST sibling at the very top of the Humanness Index™.",
        ],
        sourceUrls: [
          'https://docs.x.ai/developers/model-capabilities/audio/voice',
        ],
      },
      {
        heading: 'Release history',
        paragraphs: [
          'Streaming shares the Grok TTS stack that reached general availability in April 2026. The WebSocket endpoint accepts unbounded text over a persistent connection, unlike the 15,000 character cap on REST requests, and bills at the same flat per character rate.',
        ],
        sourceUrls: ['https://x.ai/news/grok-stt-and-tts-apis'],
      },
    ],
    faq: [
      HOW_TESTED('Grok TTS (Streaming)'),
      {
        question: 'How does Grok TTS (Streaming) differ from Grok TTS?',
        answer:
          'Same Grok Voice stack and voices; the difference is transport. Streaming holds a WebSocket open, accepts unbounded text, and starts returning audio before the full input is processed, which suits live agents.',
      },
    ],
  },

  /* -------------------------------- MiniMax ------------------------------- */
  {
    id: 'minimax-minimax-tts',
    slug: 'minimax-tts',
    providerId: 'minimax',
    // Renamed from 'MiniMax TTS' (2026-06-11), then to 'Speech 2.8'
    // (2026-07-23, PRO-3361): MiniMax confirmed the benchmarked generation
    // was Speech 2.8, turbo tier. Frozen ids unchanged; apiModelId keeps the
    // request id the June 2026 run was configured with.
    name: 'Speech 2.8',
    apiModelId: 'speech-2.5-turbo-preview',
    arenaApiId: 'minimax-tts',
    status: 'active',
    releaseDate: {
      value: '2026-01',
      sourceUrl: 'https://platform.minimax.io/docs/guides/models-intro',
      asOf: '2026-07-23',
      confidence: 'medium',
      note: 'Speech 2.8 family (speech-2.8-hd / speech-2.8-turbo). The arena clips are this generation, turbo tier, per MiniMax; the Speech-02 series preceded it in 2025-04 and Speech 2.5 in 2025-08.',
    },
    stats: {
      latencyMs: measuredTtfb(
        325,
        'Measured on the MiniMax realtime turbo tier (June 2026 run, configured with the speech-2.5-turbo-preview request id); median of 50 sequential live streaming trials including network RTT.',
      ),
    },
    voiceProfile: 8,
    seedLikelyRank: '#5-13',
    sample: {
      // Original arena fallback used a retired voice-elliot variant;
      // re-pinned to the active Clara variant.
      fallbackClip: clip(
        'voice-clara',
        'minimax',
        'minimax-tts',
        'clip-06',
        '85c500a4bcd762cdd5000a81ae6b0400',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "MiniMax's speech models moved fast through 2025 and into 2026, with the Speech-02 series arriving in April 2025, Speech 2.5 following in August, and the Speech 2.8 generation current since early 2026. The current generation supports more than 40 languages and clones a voice from roughly six to ten seconds of reference audio, using a learnable speaker encoder that needs no transcript. MiniMax is widely regarded as the strongest text to speech provider for Chinese, and its recent generations brought English accuracy and rhythm up alongside it.",
        ],
        sourceUrls: ['https://platform.minimax.io/docs/guides/models-intro'],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'The arena clips on this Index were generated with the Speech 2.8 generation, turbo tier, the realtime tier we also measured for latency. In our 50 trial streaming benchmark it returned first audio in a median of 325 ms.',
        ],
        sourceUrls: [
          'https://platform.minimax.io/docs/api-reference/speech-t2a-http',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Speech 2.8'),
      {
        question: 'Which MiniMax generation do the arena clips use?',
        answer:
          'The clips were generated with the Speech 2.8 generation, turbo tier, per MiniMax, the realtime tier we also measured for latency (325 ms median TTFB). This entry was labeled Speech 2.5 until July 2026, when MiniMax confirmed the benchmarked generation was 2.8.',
      },
      {
        question: 'Was the HD or Turbo variant benchmarked?',
        answer:
          'Turbo. Both the clips and the 325 ms latency figure come from the realtime turbo tier. The blind evaluation itself runs on 20 English customer support prompts, while MiniMax advertises more than 40 languages of capability for the generation.',
      },
    ],
  },

  {
    id: 'minimax-speech-02-hd',
    slug: 'minimax-speech-02-hd',
    providerId: 'minimax',
    name: 'Speech 2 HD',
    apiModelId: 'speech-02-hd',
    arenaApiId: 'speech-02-hd',
    status: 'active',
    releaseDate: {
      value: '2025-04',
      sourceUrl: 'https://www.minimax.io/news/speech-02-series',
      asOf: '2026-06-11',
      note: 'Series launch post dated April 2, 2025; rollout coverage ran through May 2025.',
    },
    stats: {
      latencyMs: pipelineTtfb(357),
      languages: {
        value: 32,
        sourceUrl: 'https://arxiv.org/abs/2505.07916',
        asOf: '2026-06-11',
        note: 'MiniMax-Speech technical report (the Speech-02 architecture) lists 32 languages.',
      },
      pricing: {
        value: '$100',
        sourceUrl: 'https://platform.minimax.io/docs/guides/pricing-paygo',
        asOf: '2026-06-11',
        note: 'T2A pay-as-you-go: speech-02-hd at $100 per 1M characters.',
      },
    },
    voiceProfile: 20,
    sample: {
      fallbackClip: clip(
        'voice-godfrey',
        'minimax',
        'speech-02-hd',
        'clip-04',
        '11861ccdc3f391d95be167edaeb37ef9',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          'Speech 2 HD (speech-02-hd in the API) is the high fidelity tier of the MiniMax Speech 2 generation, launched in April 2025 for voiceover and audiobook work where rhythm consistency and clarity matter most. The generation behind it, documented in the MiniMax-Speech technical report, pairs an autoregressive Transformer with a learnable speaker encoder that clones a voice from roughly ten seconds of reference audio with no transcript, across 32 languages. Speech 2 HD topped the Artificial Analysis Speech Arena ELO rankings on release, ahead of OpenAI and ElevenLabs.',
        ],
        sourceUrls: [
          'https://www.minimax.io/news/speech-02-series',
          'https://arxiv.org/abs/2505.07916',
        ],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'The quality tier of the Speech 2 pair, against Speech 2 Turbo as the realtime tier. In our 50 trial streaming benchmark it returned first audio in a median of 357 ms including network time, close behind its Turbo sibling despite the fidelity focus.',
        ],
        sourceUrls: [
          'https://platform.minimax.io/docs/api-reference/speech-t2a-http',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Speech 2 HD'),
      {
        question: 'How does Speech 2 HD differ from Speech 2 Turbo?',
        answer:
          'Same generation, different tuning. Speech 2 HD targets high fidelity output for voiceovers and audiobooks and bills at $100 per 1M characters; Speech 2 Turbo targets realtime interaction at $60 per 1M. In our 50 trial benchmark they measured 357 ms and 315 ms median time to first audio respectively.',
      },
    ],
  },
  {
    id: 'minimax-speech-02-turbo',
    slug: 'minimax-speech-02-turbo',
    providerId: 'minimax',
    name: 'Speech 2 Turbo',
    apiModelId: 'speech-02-turbo',
    arenaApiId: 'speech-02-turbo',
    status: 'active',
    releaseDate: {
      value: '2025-04',
      sourceUrl: 'https://www.minimax.io/news/speech-02-series',
      asOf: '2026-06-11',
      note: 'Series launch post dated April 2, 2025; rollout coverage ran through May 2025.',
    },
    stats: {
      latencyMs: pipelineTtfb(315),
      languages: {
        value: 32,
        sourceUrl: 'https://arxiv.org/abs/2505.07916',
        asOf: '2026-06-11',
        note: 'MiniMax-Speech technical report (the Speech-02 architecture) lists 32 languages.',
      },
      pricing: {
        value: '$60',
        sourceUrl: 'https://platform.minimax.io/docs/guides/pricing-paygo',
        asOf: '2026-06-11',
        note: 'T2A pay-as-you-go: speech-02-turbo at $60 per 1M characters.',
      },
    },
    voiceProfile: 21,
    sample: {
      fallbackClip: clip(
        'voice-clara',
        'minimax',
        'speech-02-turbo',
        'clip-16',
        'c37ee056edd46f8fec11326fb75c45a2',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Speech 2 Turbo (speech-02-turbo in the API) is the realtime tier of the MiniMax Speech 2 generation, launched in April 2025 and optimized for low latency interactive applications like voice agents and live translation. It shares the generation's learnable speaker encoder, which clones a voice from roughly ten seconds of audio without a transcript across 32 languages, and it ranked third on the Artificial Analysis Speech Arena at release while its HD sibling held first.",
        ],
        sourceUrls: [
          'https://www.minimax.io/news/speech-02-series',
          'https://arxiv.org/abs/2505.07916',
        ],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'The realtime member of the Speech 2 pair and the direct ancestor of the Speech 2.8 entry already on the Index. In our 50 trial streaming benchmark it returned first audio in a median of 315 ms including network time, in line with the 325 ms we measured for its successor.',
        ],
        sourceUrls: [
          'https://platform.minimax.io/docs/api-reference/speech-t2a-http',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Speech 2 Turbo'),
      {
        question: 'How does Speech 2 Turbo relate to the Speech 2.8 entry?',
        answer:
          'The Speech 2.8 entry on the Index runs the newer generation, turbo tier; Speech 2 Turbo is the April 2025 realtime tier that preceded it. Both share the MiniMax cloning stack, so the blind tests compare generations of the same family directly.',
      },
    ],
  },

  /* -------------------------------- Gradium ------------------------------- */
  {
    id: 'gradium-gradium-tts',
    slug: 'gradium-tts',
    providerId: 'gradium',
    name: 'Gradium TTS',
    apiModelId: 'gradiumtts',
    arenaApiId: 'gradiumtts',
    status: 'active',
    releaseDate: {
      value: '2025-12-02',
      sourceUrl: 'https://gradium.ai/blog/gradium',
      asOf: '2026-06-10',
      note: 'Out of stealth with production APIs; company founded 2025-09.',
    },
    stats: {
      latencyMs: teamReportedTtfb(332, '2026-06-11'),
      voiceCloning: {
        value: '10 s sample',
        sourceUrl: 'https://docs.gradium.ai/api-reference/endpoint/tts-post',
        asOf: '2026-06-10',
      },
    },
    voiceProfile: 16,
    seedLikelyRank: '#15-16',
    sample: {
      fallbackClip: clip(
        'voice-emma',
        'gradium',
        'gradiumtts',
        'clip-14',
        'c512189bdc6de943ac6fb6eeb994a162',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          'Gradium TTS comes from the Paris based team behind Kyutai, the open research lab that shipped the first real time conversational speech model. Founded in September 2025 by generative audio pioneers from Google DeepMind and Meta, Gradium raised a $70M seed and launched production speech APIs in December 2025. Its text to speech streams with time to first audio well under 300 ms from servers in Europe and the US, speaks English, French, Spanish, Portuguese, and German, and clones a voice from a ten second sample.',
        ],
        sourceUrls: ['https://gradium.ai/blog/gradium'],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'Five languages, ten second cloning, and streaming from EU and US servers. The Index shows 332 ms, measured by the Vapi team in June 2026; Gradium reports around 155 ms on the independent Coval benchmark from its own region.',
        ],
        sourceUrls: ['https://docs.gradium.ai/api-reference/endpoint/tts-post'],
      },
    ],
    faq: [
      HOW_TESTED('Gradium TTS'),
      {
        question: 'What latency does Gradium TTS have?',
        answer:
          'The Index shows 332 ms to first audio, measured by the Vapi team in June 2026. Gradium publishes under 300 ms from EU and US servers and posts around 155 ms on the independent Coval benchmark; distance to its regions explains much of the spread.',
      },
    ],
  },

  /* ------------------------------ Canopy Labs ----------------------------- */
  {
    id: 'canopy-orpheus',
    slug: 'canopy-orpheus',
    providerId: 'canopylabs',
    name: 'Orpheus',
    apiModelId: 'orpheus',
    arenaApiId: 'orpheus',
    status: 'active',
    releaseDate: {
      value: '2025-03-18',
      sourceUrl: 'https://canopylabs.ai/model-releases',
      asOf: '2026-06-10',
      note: 'Multilingual research preview followed in 2025-04.',
    },
    stats: {
      latencyMs: null,
      openSource: {
        value: 'Apache 2.0',
        sourceUrl: 'https://github.com/canopyai/Orpheus-TTS',
        asOf: '2026-06-10',
        note: 'Code Apache 2.0; weights under the Llama 3.2 Community License.',
      },
      voiceCloning: {
        value: 'zero-shot',
        sourceUrl: 'https://github.com/canopyai/Orpheus-TTS',
        asOf: '2026-06-10',
      },
    },
    voiceProfile: 4,
    seedLikelyRank: '#3-10',
    sample: {
      fallbackClip: clip(
        'voice-nelliot',
        'canopylabs',
        'orpheus',
        'clip-09',
        '8d9e3560c1f12cfc9cf7de197627fbd5',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Orpheus is Canopy Labs' open source speech LLM, released in March 2025 under the Apache 2.0 license. It is built on a Llama 3.2 3B backbone trained on more than 100,000 hours of English speech, and it showed that an open model can compete with closed source rivals on prosody and empathy. It supports zero shot voice cloning, tag based emotion control, and real time streaming at roughly 200 ms time to first audio on optimized hosts. Teams can self host it or run it through managed providers such as Baseten.",
        ],
        sourceUrls: [
          'https://github.com/canopyai/Orpheus-TTS',
          'https://canopylabs.ai/model-releases',
        ],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'The open weights entry on the Index: a Llama 3.2 3B backbone, zero shot cloning, emotion tags, and promised 1B, 400M, and 150M variants. Canopy Labs selected Baseten as its preferred inference provider in May 2025, with an FP8 implementation for production serving. It has no hosted first party API, so the Index shows no measured latency.',
        ],
        sourceUrls: [
          'https://www.baseten.co/blog/canopy-labs-selects-baseten-as-preferred-inference-provider-for-orpheus-tts-model/',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Orpheus'),
      {
        question: 'Is Orpheus really open source?',
        answer:
          'Yes. The code is Apache 2.0 and the weights are published under the Llama 3.2 Community License, so teams can self host it or run it through managed providers such as Baseten. It has no commercial per character price.',
      },
    ],
  },

  /* -------------------------------- Inworld ------------------------------- */
  {
    id: 'inworld-tts-15-max',
    slug: 'inworld-tts-1-5-max',
    providerId: 'inworld',
    name: 'TTS-1.5-max',
    apiModelId: 'tts-1-5-max',
    arenaApiId: 'tts-1-5-max',
    status: 'active',
    releaseDate: {
      value: '2025',
      sourceUrl: 'https://docs.inworld.ai/release-notes/tts',
      asOf: '2026-06-10',
      confidence: 'medium',
      note: 'Late 2025; Inworld published no exact date.',
    },
    stats: {
      latencyMs: measuredTtfb(337),
    },
    voiceProfile: 11,
    seedLikelyRank: '#3-14',
    sample: {
      fallbackClip: clip(
        'voice-nelliot',
        'inworld',
        'tts-1-5-max',
        'clip-20',
        'd4573b432fb6be9a80d4f094c931b349',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "TTS-1.5-max is the flagship of Inworld's 1.5 generation, launched in late 2025 with P90 first chunk latency under 250 ms across 15 languages. Inworld measured the generation at 30 percent more expressive than its predecessor with a 40 percent lower word error rate, and the 1.5 line reached the top of the Artificial Analysis Speech Arena ahead of Google and ElevenLabs. It targets the quality and speed balance most production agents need.",
        ],
        sourceUrls: ['https://docs.inworld.ai/release-notes/tts'],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'The quality and speed flagship of the 1.5 generation, with a mini sibling for the lowest latency. In our 50 trial streaming benchmark it returned first audio in a median of 337 ms including network time.',
        ],
        sourceUrls: ['https://docs.inworld.ai/release-notes/tts'],
      },
    ],
    faq: [
      HOW_TESTED('TTS-1.5-max'),
      {
        question: 'What does the max in TTS-1.5-max mean?',
        answer:
          "It is the flagship of Inworld's 1.5 generation, tuned for quality at production speed, with published P90 first chunk latency under 250 ms. A mini sibling targets the lowest latency.",
      },
    ],
  },
  {
    id: 'inworld-tts-2',
    slug: 'inworld-tts-2',
    providerId: 'inworld',
    name: 'TTS-2',
    apiModelId: 'tts-2',
    arenaApiId: 'tts-2',
    status: 'active',
    releaseDate: {
      value: '2026-05-05',
      sourceUrl: 'https://inworld.ai/blog/realtime-tts-2',
      asOf: '2026-06-10',
      note: 'Research preview.',
    },
    stats: {
      latencyMs: measuredTtfb(288),
      languages: {
        value: '100+',
        sourceUrl: 'https://inworld.ai/blog/realtime-tts-2',
        asOf: '2026-06-10',
        note: 'One voice identity held across more than 100 languages.',
      },
      pricing: {
        value: '$25',
        sourceUrl: 'https://inworld.ai/pricing',
        asOf: '2026-06-10',
        note: 'On-demand rate, $25 per 1M characters (cheaper tier than TTS 1.5 Max).',
      },
    },
    voiceProfile: 13,
    seedLikelyRank: '#3-14',
    sample: {
      // Original arena fallback used a retired voice-elliot variant;
      // re-pinned to the active Clara variant.
      fallbackClip: clip(
        'voice-clara',
        'inworld',
        'tts-2',
        'clip-15',
        'e94cb897604f768ad8234da8c22cc0b0',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Realtime TTS-2 is Inworld's frontier voice model, released in May 2026 as a research preview. It conditions on the audio of prior conversation turns, picking up the user's tone, pacing, and emotional state before deciding not just what to say but how to say it. Developers direct it with plain English steering instructions instead of fixed emotion enums, and it holds a single voice identity across more than 100 languages. Teams on TTS-1.5 upgrade by changing one model identifier.",
        ],
        sourceUrls: ['https://inworld.ai/blog/realtime-tts-2'],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'Conversation aware synthesis, plain English steering tags, Advanced Voice Design personas, and integration partners that include Vapi. In our 50 trial streaming benchmark it returned first audio in a median of 288 ms.',
        ],
        sourceUrls: ['https://inworld.ai/blog/realtime-tts-2'],
      },
    ],
    faq: [
      HOW_TESTED('TTS-2'),
      {
        question: 'What makes Realtime TTS-2 different?',
        answer:
          "It conditions on the audio of prior conversation turns, picking up the user's tone and pacing before deciding how to speak. Developers steer it with plain English instructions, and it holds one voice identity across more than 100 languages.",
      },
    ],
  },

  /* ------------------------------ Smallest.ai ----------------------------- */
  {
    id: 'smallestai-lightning-v31',
    slug: 'smallestai-lightning-v31',
    providerId: 'smallestai',
    name: 'Lightning v3.1',
    // Vendor model field on the unified /waves/v1/tts route (underscore
    // form); the dotted per-model URLs are deprecated, retiring 2026-07-14.
    apiModelId: 'lightning_v3.1',
    arenaApiId: 'lightning-v31',
    status: 'active',
    releaseDate: {
      value: '2026-01',
      sourceUrl:
        'https://smallestai-ff1e543d.mintlify.app/v4.0.0/content/changelog/announcements',
      asOf: '2026-06-12',
      confidence: 'medium',
      note: 'Waves changelog lists the v3.1 release in January 2026; the Lightning V3 family launch post followed on 2026-03-27.',
    },
    stats: {
      latencyMs: pipelineTtfb(420),
      languages: {
        value: 12,
        sourceUrl:
          'https://docs.smallest.ai/waves/model-cards/text-to-speech/lightning-v-3-1',
        asOf: '2026-06-12',
        note: 'Model card: 12 languages with auto-detection and code-switching; the launch post lists 15 including major European languages.',
      },
      streaming: {
        value: true,
        sourceUrl:
          'https://docs.smallest.ai/waves/model-cards/text-to-speech/lightning-v-3-1',
        asOf: '2026-06-12',
        note: 'HTTP, SSE, and WebSocket surfaces on the unified Waves API.',
      },
      voiceCloning: {
        value: 'instant, 5-15 s sample',
        sourceUrl:
          'https://docs.smallest.ai/waves/documentation/voice-cloning/instant-clone-api',
        asOf: '2026-06-12',
      },
    },
    voiceProfile: 22,
    sample: {
      fallbackClip: clip(
        'voice-emma',
        'smallestai',
        'lightning-v31',
        'clip-12',
        '597667ca84eb4f815f09d5d628a99cc7',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Lightning v3.1 is Smallest.ai's flagship text to speech model, a 44.1 kHz engine built for conversational agents with instant voice cloning from a 5 to 15 second sample. It reads 12 languages with automatic language detection and mid-sentence code-switching, and its launch benchmark published head to head listener wins on EmergentTTS against GPT-4o-mini TTS, ElevenLabs Turbo v2.5 and Multilingual v2, and Cartesia Sonic-3.",
        ],
        sourceUrls: [
          'https://docs.smallest.ai/waves/model-cards/text-to-speech/lightning-v-3-1',
          'https://smallest.ai/blog/introducing-lightning-v3',
        ],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'The first Smallest.ai entry on the Index, served through the unified Waves API with HTTP, SSE, and WebSocket access. Pay-as-you-go pricing sits at roughly $14.50 per 1M characters, among the lowest rates in the field. In our 50 trial streaming benchmark it returned first audio in a median of 420 ms including network time.',
        ],
        sourceUrls: [
          'https://smallest.ai/pricing',
          'https://docs.smallest.ai/waves/model-cards/text-to-speech/lightning-v-3-1',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Lightning v3.1'),
      {
        question: 'Which languages does Lightning v3.1 support?',
        answer:
          'The model card lists 12 languages spanning English, Hindi, Spanish, and nine Indian languages, with automatic language identification and mid-sentence code-switching; the Lightning V3 launch post lists 15 including French, German, Italian, Dutch, Swedish, and Portuguese.',
      },
    ],
  },

  /* ------------------------------- Neuphonic ------------------------------ */
  {
    id: 'neuphonic-neu-hq',
    slug: 'neuphonic-neu-hq',
    providerId: 'neuphonic',
    name: 'neu_hq',
    apiModelId: 'neu_hq',
    arenaApiId: 'neu-hq',
    status: 'active',
    releaseDate: {
      value: '2025-08',
      sourceUrl: 'https://docs.neuphonic.com/changelog',
      asOf: '2026-06-12',
      confidence: 'medium',
      note: 'Neuphonic published no model-specific date; its changelog marks API v1.0.0 in August 2025. The neu_hq name predates GA (the closed beta opened in late 2024).',
    },
    stats: {
      latencyMs: pipelineTtfb(276),
      languages: {
        value: 9,
        sourceUrl: 'https://docs.neuphonic.com/build-group/languages',
        asOf: '2026-06-12',
        note: 'English, Chinese, French, German, Japanese, Korean, Spanish, Portuguese, and Urdu.',
      },
      streaming: {
        value: true,
        sourceUrl: 'https://docs.neuphonic.com/build-group/text-to-speech',
        asOf: '2026-06-12',
        note: 'SSE and WebSocket streaming surfaces.',
      },
      voiceCloning: {
        value: 'instant, ~6 s sample',
        sourceUrl: 'https://docs.neuphonic.com/build-group/voice-cloning',
        asOf: '2026-06-12',
        note: 'Docs ask for a 6 second or longer clean sample; in practice the clone endpoint accepts roughly 3-10 s clips.',
      },
    },
    voiceProfile: 23,
    sample: {
      fallbackClip: clip(
        'voice-godfrey',
        'neuphonic',
        'neu-hq',
        'clip-15',
        'df6e96d1375941cca41e3b1b2045e684',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "neu_hq is the quality tier of Neuphonic's text to speech line and the model name its SDKs and integrations carry by default. Neuphonic, a London startup founded in 2024, pairs the hosted API with an open source on-device family (NeuTTS), and the hosted service streams over SSE and WebSockets across nine languages with instant voice cloning.",
        ],
        sourceUrls: [
          'https://docs.neuphonic.com/build-group/text-to-speech',
          'https://github.com/neuphonic/neutts',
        ],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          "Neuphonic's public API currently serves a single voice pool and does not expose model selection, so this entry represents that served system under its neu_hq branding. The historical neu_fast realtime sibling is not listed separately: with one pool behind the API, a second row would test the same model twice. In our 50 trial streaming benchmark it returned first audio in a median of 276 ms including network time.",
        ],
        sourceUrls: ['https://docs.neuphonic.com/build-group/text-to-speech'],
      },
    ],
    faq: [
      HOW_TESTED('neu_hq'),
      {
        question: 'Why is neu_fast not on the Index?',
        answer:
          'Neuphonic historically exposed neu_fast as the realtime sibling of neu_hq, but the current public API does not expose model selection and serves one voice pool. The Index lists that pool once, under the neu_hq name; a separate neu_fast entry would put two names on the same system.',
      },
    ],
  },

  /* ------------------------------- Speechify ------------------------------ */
  {
    id: 'speechify-simba-3-2',
    slug: 'speechify-simba-3-2',
    providerId: 'speechify',
    name: 'Simba 3.2',
    apiModelId: 'simba-3.2',
    // Frozen without the dot, like the Inworld ids: it feeds the variant ids
    // and audio content hashes.
    arenaApiId: 'simba-3-2',
    status: 'active',
    releaseDate: {
      value: '2026-07-08',
      sourceUrl: 'https://docs.speechify.ai/build/changelog/2026/7/8',
      asOf: '2026-07-23',
      note: 'API availability of simba-3.2 on the speech and stream endpoints.',
    },
    stats: {
      // Measured 2026-07-30 on POST /v1/audio/stream via
      // pipeline/transports/speechify.ts: 50 clean trials, zero errors, zero
      // rate-limit hits (p90 552 / min 396 / max 957 / stdev 90). Benched on
      // raw PCM, the endpoint's lowest-latency mode, matching how the rest of
      // the field is measured; asking the same endpoint for MP3 instead costs
      // ~150 ms (two 50-trial runs at 575 and 581 ms). The clips stay
      // vendor-rendered; only the bench runs against our own key.
      latencyMs: pipelineTtfb(
        428,
        'Measured on the chunked HTTP /v1/audio/stream endpoint at raw PCM output (16-bit, 24 kHz), using an allow-list voice (the arena clones are not registered on simba-3.2); median of 50 sequential trials, July 2026, including network RTT.',
        '2026-07-30',
      ),
      languages: {
        value: 'English',
        sourceUrl: 'https://docs.speechify.ai/build/guides/concepts/models',
        asOf: '2026-07-23',
        note: 'English only at launch; Speechify says multilingual support will land under the same model id.',
      },
      voiceCloning: {
        value: 'zero-shot, manual approval',
        sourceUrl: 'https://docs.speechify.ai/build/guides/concepts/models',
        asOf: '2026-07-23',
        note: 'Cloned voices are supported on simba-3.2, but each voice key currently requires manual Speechify approval.',
      },
    },
    voiceProfile: 25,
    sample: {
      fallbackClip: clip(
        'voice-emma',
        'speechify',
        'simba-3-2',
        'clip-10',
        'ecb602ac01a8867cea91e9802fa56357',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "Simba 3.2 is Speechify's streaming native flagship, released to the SpeechifyAI API in July 2026 as the recommended model for new English integrations. Speechify positions it on expressivity and time to first byte, and it debuted statistically tied for first place on the Artificial Analysis TTS leaderboard. It serves a curated voice allow list, with cloned voices supported behind a manual approval step.",
        ],
        sourceUrls: [
          'https://docs.speechify.ai/build/changelog/2026/7/8',
          'https://speechify.ai/text-to-speech-api',
        ],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'The arena clips for Simba 3.2 were rendered by Speechify with the four licensed source voices cloned on its platform, then verified and hosted by the Index team under the same frozen content hash scheme as every other model, the same vendor supplied path used where the pipeline has no API access. Latency is our own measurement: the 50 trial streaming benchmark ran against a Speechify key in July 2026 and returned a 428 ms median, so the figure here is measured rather than vendor supplied.',
        ],
        sourceUrls: [
          'https://docs.speechify.ai/build/guides/concepts/models',
        ],
      },
    ],
    faq: [
      HOW_TESTED('Simba 3.2'),
      {
        question: 'Where did the Simba 3.2 arena clips come from?',
        answer:
          'Speechify rendered the 80 arena clips (four cloned source voices reading the 20 frozen prompts) with simba-3.2 and supplied them to the Index team, who normalized, verified, and hosted them under the frozen content hash scheme. Blind battles and scoring work exactly as for every other model.',
      },
    ],
  },

  /* ------------------------------- Fish Audio ----------------------------- */
  {
    id: 'fish-s21-pro',
    slug: 'fish-s2-1-pro',
    providerId: 'fish',
    name: 'S2.1-Pro',
    apiModelId: 's2.1-pro',
    // Frozen without the dots, like the Inworld and Speechify ids: it feeds
    // the variant ids and audio content hashes.
    arenaApiId: 's2-1-pro',
    status: 'active',
    releaseDate: {
      value: '2026-06',
      sourceUrl: 'https://fish.audio/blog/s2-1-pro-free-api/',
      asOf: '2026-07-30',
      confidence: 'medium',
      note: 'Fish announced S2.1-Pro on the API in June 2026 and made it the recommended production model at its public launch in late July 2026; no finer vendor date is published.',
    },
    stats: {
      latencyMs: pipelineTtfb(
        141,
        'Median of 50 sequential live streaming trials, July 2026, over the msgpack WebSocket stream on the default stock voice; includes network RTT from the benchmark machine.',
        '2026-07-30',
      ),
      languages: {
        value: 83,
        sourceUrl:
          'https://docs.fish.audio/developer-guide/models-pricing/models-overview',
        asOf: '2026-07-30',
        note: 'One model across all 83 languages with automatic language detection, no per-language endpoints.',
      },
      streaming: {
        value: true,
        sourceUrl:
          'https://docs.fish.audio/api-reference/endpoint/websocket/tts-live',
        asOf: '2026-07-30',
        note: 'Realtime msgpack WebSocket stream alongside the batch HTTP endpoint.',
      },
      voiceCloning: {
        value: 'instant, 10-30 s sample',
        sourceUrl:
          'https://docs.fish.audio/developer-guide/sdk-guide/cookbook/instant-voice-cloning',
        asOf: '2026-07-30',
        note: 'Reference audio can be passed per request or saved as a reusable voice model; the docs ask for 10 to 30 s of clean speech.',
      },
    },
    voiceProfile: 26,
    sample: {
      fallbackClip: clip(
        'voice-clara',
        'fish',
        's2-1-pro',
        'clip-10',
        '6c38a26b08616337c396e2218d68086b',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          "S2.1-Pro is Fish Audio's recommended production model, an improved S2-Pro that the company put at the center of its July 2026 launch. It reads inline bracket cues such as [whispers sweetly] as natural language rather than a fixed tag set, handles multi-speaker dialogue, and holds one voice identity across all 83 languages it supports.",
        ],
        sourceUrls: [
          'https://docs.fish.audio/developer-guide/models-pricing/models-overview',
          'https://fish.audio/blog/s2-1-pro-free-api/',
        ],
      },
      {
        heading: 'At a glance',
        paragraphs: [
          'The arena clips for S2.1-Pro were rendered by Fish Audio with the four licensed source voices cloned on its platform, then verified and hosted by the Index team under the same frozen content hash scheme as every other model, the same vendor supplied path used where the pipeline has no API access. Latency is ours, not theirs: in our 50 trial benchmark over the realtime WebSocket it returned first audio in a median of 141 ms including network time, one of the three fastest models on the Index. Fish quotes roughly 90 ms, measured without that network leg.',
        ],
        sourceUrls: [
          'https://fish.audio/blog/s2-1-pro-free-api/',
          'https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits',
        ],
      },
    ],
    faq: [
      HOW_TESTED('S2.1-Pro'),
      {
        question: 'Where did the S2.1-Pro arena clips come from?',
        answer:
          'Fish Audio rendered the 80 arena clips (four cloned source voices reading the 20 frozen prompts) with s2.1-pro and supplied them to the Index team, who checked every clip against the frozen script, normalized them, and hosted them under the frozen content hash scheme. Blind battles and scoring work exactly as for every other model.',
      },
      {
        question: 'What does S2.1-Pro cost?',
        answer:
          'Fish Audio bills $15 per 1M UTF-8 bytes of input text on s2.1-pro, roughly 180,000 English words. A second model string, s2.1-pro-free, runs the same model at no cost under a fair use policy, without the SLA and latency guarantees of the paid tier.',
      },
    ],
  },

  /* --------------------------------- Human -------------------------------- */
  // The Human baseline: the four source-voice actors reading the same 20
  // lines. Not a TTS model. `baseline: true` pins its Humanness score to 100
  // (catalog anchor) and keeps it off the model/provider counts, the
  // highlight cards, and the latency chart. Frozen ids (provider/model/api
  // all `human`) feed the clip hashes; the recordings are ingested by
  // pipeline/ingestHumanClips.ts. Unseeded: it enters at Elo 1200 on the
  // first "which one is human?" votes.
  {
    id: 'human',
    slug: 'human',
    providerId: 'human',
    // Easter egg: the provider stays "Human"; the model is the species name.
    // Frozen identity (id/slug/apiModelId/arenaApiId = `human`) is unchanged
    // since it feeds the clip hashes.
    name: 'Homo Sapien',
    apiModelId: 'human',
    arenaApiId: 'human',
    status: 'active',
    baseline: true,
    // Recorded source voices only: the arena builds Human variants and battle
    // pairings for these voices alone, so Human is never matched on a voice it
    // has no clips for. Extend this list (one line) as each voice's 20
    // recordings are uploaded and HEAD-verified. As of 2026-06-15 all four
    // source voices are live: Clara + Nelliot first, then Godfrey + Emma.
    sourceVoices: ['voice-clara', 'voice-nelliot', 'voice-godfrey', 'voice-emma'],
    stats: {
      // No reachable API to measure and no per-character price: a person read
      // the line. Both render as a dash, and the null latency keeps Human off
      // the latency chart like the other unmeasured rows.
      latencyMs: null,
    },
    voiceProfile: 24,
    sample: {
      // voice-clara x clip-01: sha256("variant:voice-clara:human:human|clip-01|settings-v3")[:32].
      // The recording is ingested to this hash by humanness:human-clips.
      fallbackClip: clip(
        'voice-clara',
        'human',
        'human',
        'clip-01',
        'fe137bcb33a0ce1178283e7ea3c6888e',
      ),
    },
    copy: [
      {
        heading: 'Background',
        paragraphs: [
          'Human is the baseline reference on the Humanness Index rather than a text to speech model. The four source voices on the Index, Clara, Emma, Godfrey, and Nelliot, are real people, and each of them recorded the same 20 customer support lines that every TTS model reads, false starts and filler words included. In a battle a Human recording goes head to head against a cloned TTS version of the same voice reading the same line, so the listener is answering one question: which one is human?',
        ],
      },
      {
        heading: 'Why it anchors 100',
        paragraphs: [
          'Human is pinned to a Humanness score of 100, and every model is then read as a share of that human mark. It is a reference, not a competitor, so it sits outside the model and provider counts, it does not appear in the most human highlight cards, and it carries no latency or price. The recordings are loudness normalized and converted to MP3 on ingest, the same handling the synthetic clips get, so the only thing a listener compares is the voice.',
        ],
      },
    ],
    faq: [
      {
        question: 'Is Human a text to speech model?',
        answer:
          'No. Human is real people reading the lines. It is the four source voices recorded by the actors behind them, and it exists to anchor the top of the scale so every model score reads as how close that model gets to a real person.',
      },
      {
        question: 'How is the Human baseline recorded and scored?',
        answer:
          'The same four actors read all 20 lines exactly as written in a quiet room, one line per file. The recordings are loudness normalized and converted to MP3, then battle head to head against the cloned TTS of the same voice. Human is pinned to a Humanness score of 100 and the rest of the field is normalized against that anchor.',
      },
    ],
  },

  // Unannounced or embargoed entries are not listed here: they live in the
  // private registry overlay (catalog/overlay.local.ts, see SPEC 4.3) until
  // their providers announce them, then move into this file with a status
  // flip. Keep unlisted entries last when they do.
];
