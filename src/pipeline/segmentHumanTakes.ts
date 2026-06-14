/// <reference types="bun" />
/**
 * Segment one long Human-baseline voice recording into per-quote "take"
 * folders the maintainer can cull down to one keeper per quote.
 *
 *   bun run humanness:human-segment <voice> <sourceFile> [flags]
 *   bun run humanness:human-segment clara /path/to/clara.mp3
 *
 * voice ∈ clara|emma|godfrey|nelliot. The actor reads the 20 arena quotes
 * (prompts.ts) with ~2-3 takes each, roughly but NOT strictly in order, so
 * takes are matched by content, never by position.
 *
 * Pipeline:
 *  1. Transcribe with Deepgram nova-3 (word-level timestamps), caching the
 *     raw JSON under results/source-voices/human-readings/<voice>-takes/
 *     deepgram-nova3.json and reusing it unless --retranscribe.
 *  2. Fuzzy-align every quote against the transcript with a sliding window
 *     scored by ORDERED similarity (LCS F1, cheaply prefiltered by a rolling
 *     multiset overlap; normalize both sides: lowercase, drop
 *     punctuation/ellipses, collapse whitespace). Multiple high-scoring spans
 *     per quote = the repeat takes; near-duplicates are suppressed (NMS) and
 *     cross-quote dupes (shared phrasing) resolved to the better match.
 *     Over-capture is preferred to missing — the maintainer culls.
 *  3. Buffer target: download a few hosted arena clips (voice-clara variants,
 *     addressed by the frozen hashing helpers) and silencedetect their
 *     head/tail silence; the average becomes the head/tail padding so the human
 *     takes roughly match. Fallback: head 0.12s / tail 0.35s.
 *  4. Cut each take with ffmpeg. Boundaries are HARD-BOUNDED by the transcript
 *     words around the take's true first/last quote words: the start sits in the
 *     gap after the preceding word (never including it, never clipping the first
 *     word) and the end sits in the gap before the following word (with a small
 *     pad for Deepgram's under-reported final word end, never truncating it).
 *     head/tail only fill those gaps as silent padding. Output WAV, mono, 44.1 kHz.
 *  5. Write the take tree plus manifest.json and SUMMARY.md.
 *
 * NOTHING here uploads, commits, or deploys: it only produces the staging
 * tree. Flags any quote with 0 matches or an unusually high take count.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { arenaModelEntries, type ModelEntry } from '../catalog';
import { loadPipelineEnv, requireEnv } from './env';
import { clipHash, clipPublicUrl, parseArgs, variantIdFor } from './lib';
import { PROMPTS } from './prompts';

const RESULTS_DIR = resolve(import.meta.dir, 'results');
const READINGS_DIR = resolve(RESULTS_DIR, 'source-voices', 'human-readings');

const VOICES = ['clara', 'emma', 'godfrey', 'nelliot'] as const;
type Voice = (typeof VOICES)[number];

/** Defaults (overridable by flags). */
const DEFAULT_THRESHOLD = 0.7;
/** Cheap multiset prefilter slack before the exact (ordered) LCS rescore. */
const PREFILTER_MARGIN = 0.12;
/** Expected ~2-3 takes; this many or more is worth a manual look. */
const HIGH_TAKE_COUNT = 5;
/** Buffers used when clip measurement fails entirely. */
const FALLBACK_HEAD_S = 0.1;
const FALLBACK_TAIL_S = 0.45;
/**
 * Floors on the measured buffers. The cut is hard-bounded by the neighbouring
 * transcript words, so these padding amounts only ever fill the silent gap to a
 * neighbour; they are floored to safe minimums (a small synthetic head/tail
 * would otherwise clip a human onset or trailing breath).
 */
const MIN_HEAD_S = 0.1;
const MIN_TAIL_S = 0.45;
/** Pad added to a take's last word: Deepgram under-reports the final word end. */
const FINAL_PAD_S = 0.15;
/** Keep this clear of a neighbouring (non-take) word on either side. */
const NEIGHBOR_MARGIN_S = 0.05;
/** Always keep at least this much lead before the first word (onset safety). */
const MIN_LEAD_S = 0.03;
/** Inter-word gap that marks a real pause (take/chatter boundary). */
const PAUSE_GAP_S = 0.45;
/** How many hosted clips to measure for the buffer average. */
const BUFFER_PROBE_TARGET = 3;

const DEEPGRAM_URL =
  'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&utterances=true';

type DeepgramWord = {
  word?: string;
  punctuated_word?: string;
  start: number;
  end: number;
};

type DeepgramResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }>;
    }>;
  };
};

type Token = { text: string; start: number; end: number; wordIdx: number };

type Interval = { start: number; end: number };

type Take = {
  quoteId: string;
  takeIndex: number;
  score: number;
  sourceStart: number;
  sourceEnd: number;
  bufferedStart: number;
  bufferedEnd: number;
  snippet: string;
  durationSec: number;
  outRelPath: string;
};

/** Candidate span for one quote before NMS / take numbering. */
type Candidate = {
  quoteId: string;
  /** Token-stream indices of the winning window (for boundary refinement). */
  startTok: number;
  endTok: number;
  startWord: number;
  endWord: number;
  startTime: number;
  endTime: number;
  score: number;
};

/* ----------------------------- text normalize ---------------------------- */

/**
 * Lowercase, drop apostrophes (don't -> dont), turn ellipses and any other
 * punctuation into separators, then split. Applied to BOTH the scripted quote
 * and the Deepgram words so the comparison is purely lexical.
 */
const normalize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/\u2026/g, ' ')
    .replace(/\.\.\./g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const counts = (tokens: string[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const token of tokens) map.set(token, (map.get(token) ?? 0) + 1);
  return map;
};

/* ------------------------------- transcribe ------------------------------ */

/** Copy into a fresh ArrayBuffer-backed Blob (a clean BodyInit for fetch). */
const toBlob = (bytes: Uint8Array, type: string): Blob => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type });
};

const transcribe = async (
  bytes: Uint8Array,
  contentType: string,
): Promise<DeepgramResponse> => {
  const apiKey = requireEnv('DEEPGRAM_API_KEY');
  const response = await fetch(DEEPGRAM_URL, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': contentType },
    body: toBlob(bytes, contentType),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) {
    throw new Error(
      `Deepgram ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  return (await response.json()) as DeepgramResponse;
};

const wordsOf = (data: DeepgramResponse): DeepgramWord[] =>
  data.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];

/* ----------------------------- ffmpeg helpers ---------------------------- */

const probeDuration = (file: string): number => {
  const result = spawnSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Number.parseFloat(result.stdout?.toString().trim() ?? '') || 0;
};

/** Silence intervals from ffmpeg silencedetect on a file. */
const detectSilences = (
  file: string,
  noiseDb: number,
  minDurationSec: number,
  totalDurationSec: number,
): Interval[] => {
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
    '-f',
    'null',
    '-',
  ]);
  const log = result.stderr?.toString() ?? '';
  const intervals: Interval[] = [];
  let pendingStart: number | null = null;
  for (const line of log.split('\n')) {
    const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (startMatch) {
      pendingStart = Math.max(0, Number.parseFloat(startMatch[1]));
      continue;
    }
    const endMatch = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (endMatch && pendingStart !== null) {
      intervals.push({ start: pendingStart, end: Number.parseFloat(endMatch[1]) });
      pendingStart = null;
    }
  }
  if (pendingStart !== null) {
    intervals.push({ start: pendingStart, end: totalDurationSec });
  }
  return intervals;
};

/** Leading/trailing silence of a clip from its silence intervals. */
const edgeSilence = (
  intervals: Interval[],
  duration: number,
): { leading: number; trailing: number } => {
  const first = intervals[0];
  const last = intervals[intervals.length - 1];
  const leading = first && first.start <= 0.06 ? Math.min(first.end, duration) : 0;
  const trailing =
    last && last.end >= duration - 0.06 ? Math.max(0, duration - last.start) : 0;
  return { leading, trailing };
};

/* ------------------------------ buffer probe ----------------------------- */

const fetchBytes = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

type BufferProbe = {
  model: string;
  promptId: string;
  hash: string;
  leading?: number;
  trailing?: number;
  error?: string;
};

type BufferResult = {
  head: number;
  tail: number;
  measuredHead: number | null;
  measuredTail: number | null;
  probes: BufferProbe[];
};

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Download a few hosted arena clips (voice-clara variants, addressed via the
 * frozen hashing helpers) and average their head/tail silence. These pad the
 * human takes so they sit in the arena like the synthetic clips do.
 */
const measureBuffers = async (): Promise<BufferResult> => {
  const probes: BufferProbe[] = [];
  const leadings: number[] = [];
  const trailings: number[] = [];

  const models: ModelEntry[] = arenaModelEntries().filter(
    (model) => model.providerId !== 'human' && model.baseline !== true,
  );

  for (const model of models) {
    if (leadings.length >= BUFFER_PROBE_TARGET) break;
    const promptId = model.sample?.fallbackClip?.promptId ?? 'clip-01';
    const variantId = variantIdFor('voice-clara', model.providerId, model.arenaApiId);
    const hash = clipHash(variantId, promptId);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tmpFile = resolve(tmpdir(), `human-buffer-${stamp}.mp3`);
    try {
      const bytes = await fetchBytes(clipPublicUrl(hash));
      writeFileSync(tmpFile, bytes);
      const duration = probeDuration(tmpFile);
      const intervals = detectSilences(tmpFile, -40, 0.08, duration);
      const { leading, trailing } = edgeSilence(intervals, duration);
      leadings.push(leading);
      trailings.push(trailing);
      probes.push({ model: model.id, promptId, hash, leading, trailing });
    } catch (error) {
      probes.push({
        model: model.id,
        promptId,
        hash,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      rmSync(tmpFile, { force: true });
    }
  }

  const measuredHead = leadings.length > 0 ? mean(leadings) : null;
  const measuredTail = trailings.length > 0 ? mean(trailings) : null;
  const head = measuredHead === null ? FALLBACK_HEAD_S : Math.max(MIN_HEAD_S, measuredHead);
  const tail = measuredTail === null ? FALLBACK_TAIL_S : Math.max(MIN_TAIL_S, measuredTail);

  return {
    head: Number(head.toFixed(3)),
    tail: Number(tail.toFixed(3)),
    measuredHead: measuredHead === null ? null : Number(measuredHead.toFixed(3)),
    measuredTail: measuredTail === null ? null : Number(measuredTail.toFixed(3)),
    probes,
  };
};

/* ------------------------------- alignment ------------------------------- */

/** Longest common subsequence length (order-aware token overlap). */
const lcsLength = (a: string[], b: string[]): number => {
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    const cur = new Array<number>(n + 1).fill(0);
    const ai = a[i - 1];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = ai === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
};

const f1Of = (matches: number, windowLen: number, queryLen: number): number => {
  const precision = matches / windowLen;
  const recall = matches / queryLen;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
};

/** LCS with traceback: the matched [aIndex, bIndex] pairs in increasing order. */
const lcsPairs = (a: string[], b: string[]): Array<[number, number]> => {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  pairs.reverse();
  return pairs;
};

/**
 * Every span whose ORDERED similarity to the quote clears the threshold, then
 * NMS to one representative per take. A cheap rolling multiset overlap (an
 * upper bound on LCS) prefilters the windows; only near-matches pay for the
 * exact LCS rescore. Ordered scoring is what rejects "straddle" windows that
 * span the tail of one read plus the head of the next (a rotation of the quote
 * scores high on a bag of words but low in sequence).
 */
const findTakesForQuote = (
  quoteId: string,
  quoteText: string,
  words: DeepgramWord[],
  tokens: Token[],
  tokenTexts: string[],
  threshold: number,
): { candidates: Candidate[]; bestScore: number } => {
  const query = normalize(quoteText);
  const n = query.length;
  if (n === 0 || tokens.length === 0) return { candidates: [], bestScore: 0 };

  const queryCounts = counts(query);
  const lengths = Array.from(
    new Set([Math.max(1, Math.round(n * 0.85)), n, Math.round(n * 1.15)]),
  ).filter((length) => length <= tokens.length);
  const prefilter = threshold - PREFILTER_MARGIN;

  const raw: Candidate[] = [];
  let bestScore = 0;

  for (const length of lengths) {
    const windowCounts = new Map<string, number>();
    let intersection = 0;

    const add = (token: string): void => {
      const have = windowCounts.get(token) ?? 0;
      if (have < (queryCounts.get(token) ?? 0)) intersection += 1;
      windowCounts.set(token, have + 1);
    };
    const remove = (token: string): void => {
      const have = windowCounts.get(token) ?? 0;
      if (have <= (queryCounts.get(token) ?? 0)) intersection -= 1;
      windowCounts.set(token, have - 1);
    };

    for (let i = 0; i < length; i += 1) add(tokens[i].text);

    for (let start = 0; start + length <= tokens.length; start += 1) {
      // Cheap upper bound first; only rescore windows that could clear the bar.
      if (f1Of(intersection, length, n) >= prefilter) {
        const matches = lcsLength(tokenTexts.slice(start, start + length), query);
        const score = f1Of(matches, length, n);
        if (score > bestScore) bestScore = score;
        if (score >= threshold) {
          const startTok = tokens[start];
          const endTok = tokens[start + length - 1];
          raw.push({
            quoteId,
            startTok: start,
            endTok: start + length - 1,
            startWord: startTok.wordIdx,
            endWord: endTok.wordIdx,
            startTime: words[startTok.wordIdx].start,
            endTime: words[endTok.wordIdx].end,
            score: Number(score.toFixed(4)),
          });
        }
      }
      if (start + length < tokens.length) {
        remove(tokens[start].text);
        add(tokens[start + length].text);
      }
    }
  }

  return { candidates: nonMaxSuppress(raw, 0.5), bestScore: Number(bestScore.toFixed(4)) };
};

/** Fraction of the shorter span that overlaps the other (time-based). */
const overlapFraction = (a: Candidate, b: Candidate): number => {
  const lo = Math.max(a.startTime, b.startTime);
  const hi = Math.min(a.endTime, b.endTime);
  const inter = Math.max(0, hi - lo);
  const minLen = Math.min(a.endTime - a.startTime, b.endTime - b.startTime);
  return minLen <= 0 ? 0 : inter / minLen;
};

/** Greedy NMS: keep the highest score, drop anything overlapping it past `maxOverlap`. */
const nonMaxSuppress = (candidates: Candidate[], maxOverlap: number): Candidate[] => {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const candidate of sorted) {
    if (kept.every((other) => overlapFraction(candidate, other) <= maxOverlap)) {
      kept.push(candidate);
    }
  }
  return kept;
};

/* ---------------------------- boundary refinement ------------------------ */

type WordSpan = { firstWordIdx: number; lastWordIdx: number };

/**
 * The take's TRUE quote-word span: align the quote to the winning window, take
 * the first/last transcript words that actually align to a quote word (this
 * trims leading chatter and the tail of a previous take), then recover any
 * trailing quote words the window dropped. The trailing walk only crosses
 * CONTIGUOUS speech and stops once the quote runs out, so a back-to-back repeat
 * take can never be swallowed.
 */
const resolveSpan = (candidate: Candidate, tokens: Token[], query: string[]): WordSpan => {
  const coreTexts = tokens.slice(candidate.startTok, candidate.endTok + 1).map((t) => t.text);
  const pairs = lcsPairs(coreTexts, query);
  if (pairs.length === 0) {
    return {
      firstWordIdx: tokens[candidate.startTok].wordIdx,
      lastWordIdx: tokens[candidate.endTok].wordIdx,
    };
  }

  const firstTok = candidate.startTok + pairs[0][0];
  let lastTok = candidate.startTok + pairs[pairs.length - 1][0];
  let quoteIdx = pairs[pairs.length - 1][1];

  // Recover dropped trailing quote words (e.g. "talking about" cut off the end).
  let ti = lastTok + 1;
  let qi = quoteIdx + 1;
  let skips = 0;
  while (qi < query.length && ti < tokens.length) {
    if (tokens[ti].start - tokens[ti - 1].end > PAUSE_GAP_S) break;
    if (tokens[ti].text === query[qi]) {
      lastTok = ti;
      quoteIdx = qi;
      ti += 1;
      qi += 1;
      skips = 0;
    } else if (skips < 2) {
      ti += 1;
      skips += 1;
    } else {
      break;
    }
  }

  return { firstWordIdx: tokens[firstTok].wordIdx, lastWordIdx: tokens[lastTok].wordIdx };
};

/* --------------------------------- cutting ------------------------------- */

/**
 * Start cut: in the silent gap between the take's first quote word and whatever
 * precedes it. No preceding word may leak in (start >= prevWord.end), and the
 * first word's onset is never clipped (always keep a small lead). Prefers a full
 * `head` of lead, then the neighbour margin; when the gap is tighter than the
 * margin the lead guarantee wins (down to the available gap) so we never start
 * exactly on the onset.
 */
const computeStart = (
  firstWord: DeepgramWord,
  prevWord: DeepgramWord | undefined,
  head: number,
): number => {
  let start = firstWord.start - head;
  const preferredLo = prevWord ? prevWord.end + NEIGHBOR_MARGIN_S : 0;
  if (start < preferredLo) start = preferredLo;
  // Guarantee a minimum lead before the onset, even if it eats into the margin.
  const leadCap = firstWord.start - MIN_LEAD_S;
  if (start > leadCap) start = leadCap;
  // Hard floor: never cross into the preceding word.
  if (prevWord && start < prevWord.end) start = prevWord.end;
  return Math.max(0, start);
};

/**
 * End cut: in the gap after the take's last quote word. A fixed pad offsets
 * Deepgram's under-reported final word end; the cut prefers a full `tail` but
 * snaps FORWARD only up to just before the next word, and never before the
 * final word (never truncating it).
 */
const computeEnd = (
  lastWord: DeepgramWord,
  nextWord: DeepgramWord | undefined,
  tail: number,
  duration: number,
): number => {
  const cap = nextWord ? nextWord.start - NEIGHBOR_MARGIN_S : lastWord.end + tail;
  const floor = lastWord.end + FINAL_PAD_S;
  let end = lastWord.end + tail;
  if (end > cap) end = cap;
  if (end < floor) end = Math.min(floor, cap);
  if (end < lastWord.end) end = lastWord.end;
  return Math.min(end, duration);
};

const cutWav = (source: string, start: number, duration: number, outPath: string): void => {
  const result = spawnSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-nostats',
    '-ss',
    start.toFixed(3),
    '-i',
    source,
    '-t',
    duration.toFixed(3),
    '-ac',
    '1',
    '-ar',
    '44100',
    outPath,
  ]);
  if (result.status !== 0 || !existsSync(outPath)) {
    throw new Error(`ffmpeg cut failed: ${result.stderr?.toString().slice(-300)}`);
  }
};

const snippetOf = (words: DeepgramWord[], startWord: number, endWord: number): string =>
  words
    .slice(startWord, endWord + 1)
    .map((word) => word.punctuated_word ?? word.word ?? '')
    .join(' ')
    .trim()
    .slice(0, 240);

/* ---------------------------------- main --------------------------------- */

const main = async (): Promise<void> => {
  loadPipelineEnv();
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  if (positionals.length !== 2) {
    console.error(
      'usage: bun run humanness:human-segment <voice> <sourceFile> ' +
        '[--retranscribe] [--threshold 0.7] [--head 0.12] [--tail 0.35] ' +
        '[--no-snap] [--skip-verify]',
    );
    process.exit(2);
  }

  const [voiceArg, sourceArg] = positionals;
  const voice = voiceArg.replace(/^voice-/, '') as Voice;
  if (!VOICES.includes(voice)) {
    console.error(`voice must be one of: ${VOICES.join(', ')} (got "${voiceArg}")`);
    process.exit(2);
  }
  const sourceFile = resolve(sourceArg);
  if (!existsSync(sourceFile)) {
    console.error(`source file not found: ${sourceFile}`);
    process.exit(2);
  }

  const threshold = flags.has('threshold')
    ? Number(flags.get('threshold'))
    : DEFAULT_THRESHOLD;
  const snap = !flags.has('no-snap');
  const voiceId = `voice-${voice}`;
  const outDir = resolve(READINGS_DIR, `${voice}-takes`);
  const cachePath = resolve(outDir, 'deepgram-nova3.json');
  mkdirSync(outDir, { recursive: true });

  // Clear any per-quote take folders from a previous run so re-runs never leave
  // stale takes behind (the transcript cache and reports are overwritten below).
  if (existsSync(outDir)) {
    for (const entry of readdirSync(outDir)) {
      if (/^clip-\d+$/.test(entry)) rmSync(resolve(outDir, entry), { recursive: true, force: true });
    }
  }

  const sourceDuration = probeDuration(sourceFile);
  console.log(
    `${voiceId}: segmenting ${sourceFile} (${sourceDuration.toFixed(1)}s) → ${outDir}`,
  );

  // 1. Transcribe (cache-backed).
  let transcript: DeepgramResponse;
  if (existsSync(cachePath) && !flags.has('retranscribe')) {
    console.log(`  · using cached transcript ${cachePath}`);
    transcript = JSON.parse(readFileSync(cachePath, 'utf8')) as DeepgramResponse;
  } else {
    console.log('  · transcribing with Deepgram nova-3 (this can take a minute)...');
    transcript = await transcribe(new Uint8Array(readFileSync(sourceFile)), 'audio/mpeg');
    writeFileSync(cachePath, `${JSON.stringify(transcript, null, 2)}\n`);
    console.log(`  · cached transcript → ${cachePath}`);
  }

  const words = wordsOf(transcript);
  if (words.length < 50) {
    console.error(
      `  ! only ${words.length} words returned — transcription likely failed; ` +
        'check DEEPGRAM_API_KEY or re-run with --retranscribe',
    );
    if (words.length === 0) process.exit(1);
  }
  const tokens: Token[] = [];
  words.forEach((word, wordIdx) => {
    for (const text of normalize(word.word ?? word.punctuated_word ?? '')) {
      tokens.push({ text, start: word.start, end: word.end, wordIdx });
    }
  });
  const tokenTexts = tokens.map((token) => token.text);
  console.log(`  · transcript: ${words.length} words, ${tokens.length} tokens`);

  // 2. Align every quote, then resolve cross-quote duplicates (shared phrasing).
  const bestScores = new Map<string, number>();
  let allCandidates: Candidate[] = [];
  for (const prompt of PROMPTS) {
    const { candidates, bestScore } = findTakesForQuote(
      prompt.id,
      prompt.text,
      words,
      tokens,
      tokenTexts,
      threshold,
    );
    bestScores.set(prompt.id, bestScore);
    allCandidates.push(...candidates);
  }

  const crossQuoteRemoved: Candidate[] = [];
  const globallyKept: Candidate[] = [];
  for (const candidate of [...allCandidates].sort((a, b) => b.score - a.score)) {
    const clashes = globallyKept.some(
      (other) =>
        other.quoteId !== candidate.quoteId && overlapFraction(candidate, other) > 0.6,
    );
    if (clashes) crossQuoteRemoved.push(candidate);
    else globallyKept.push(candidate);
  }

  // 3. Buffers.
  let buffers = await measureBuffers();
  if (flags.has('head')) buffers = { ...buffers, head: Number(flags.get('head')) };
  if (flags.has('tail')) buffers = { ...buffers, tail: Number(flags.get('tail')) };
  console.log(
    `  · buffers: head ${buffers.head}s, tail ${buffers.tail}s ` +
      `(measured head ${buffers.measuredHead ?? 'n/a'}, tail ${buffers.measuredTail ?? 'n/a'}; ` +
      `${buffers.probes.filter((p) => p.error === undefined).length}/${buffers.probes.length} clips)`,
  );

  // head/tail are silent padding only; the cut is hard-bounded by the
  // neighbouring transcript words below (--no-snap = tight, word-edge cuts).
  const head = snap ? buffers.head : NEIGHBOR_MARGIN_S;
  const tail = snap ? buffers.tail : FINAL_PAD_S;

  // 4 + 5. Cut takes and write the tree.
  const takesByQuote = new Map<string, Candidate[]>();
  for (const candidate of globallyKept) {
    const list = takesByQuote.get(candidate.quoteId) ?? [];
    list.push(candidate);
    takesByQuote.set(candidate.quoteId, list);
  }

  const takes: Take[] = [];
  for (const prompt of PROMPTS) {
    const query = normalize(prompt.text);
    const ordered = (takesByQuote.get(prompt.id) ?? []).sort(
      (a, b) => a.startTime - b.startTime,
    );
    const quoteDir = resolve(outDir, prompt.id);
    if (ordered.length > 0) mkdirSync(quoteDir, { recursive: true });

    ordered.forEach((candidate, index) => {
      const takeIndex = index + 1;
      // Resolve the take's true first/last quote words, then bound the cut by
      // their transcript neighbours so no extra word leaks in or gets clipped.
      const { firstWordIdx, lastWordIdx } = resolveSpan(candidate, tokens, query);
      const firstWord = words[firstWordIdx];
      const lastWord = words[lastWordIdx];
      const prevWord = firstWordIdx > 0 ? words[firstWordIdx - 1] : undefined;
      const nextWord = lastWordIdx + 1 < words.length ? words[lastWordIdx + 1] : undefined;

      const start = computeStart(firstWord, prevWord, head);
      const end = computeEnd(lastWord, nextWord, tail, sourceDuration);
      const duration = Math.max(0.1, end - start);

      const takeName = `take-${String(takeIndex).padStart(2, '0')}.wav`;
      const outPath = resolve(quoteDir, takeName);
      cutWav(sourceFile, start, duration, outPath);

      takes.push({
        quoteId: prompt.id,
        takeIndex,
        score: candidate.score,
        sourceStart: Number(firstWord.start.toFixed(3)),
        sourceEnd: Number(lastWord.end.toFixed(3)),
        bufferedStart: Number(start.toFixed(3)),
        bufferedEnd: Number(end.toFixed(3)),
        durationSec: Number(probeDuration(outPath).toFixed(3)),
        snippet: snippetOf(words, firstWordIdx, lastWordIdx),
        outRelPath: `${prompt.id}/${takeName}`,
      });
    });

    const mark = ordered.length === 0 ? '✗' : ordered.length >= HIGH_TAKE_COUNT ? '!' : '✓';
    console.log(
      `  ${mark} ${prompt.id}: ${ordered.length} take(s)` +
        (ordered.length === 0 ? ` (best score ${bestScores.get(prompt.id)})` : ''),
    );
  }

  const noMatch = PROMPTS.filter((p) => (takesByQuote.get(p.id) ?? []).length === 0).map(
    (p) => p.id,
  );
  const highCount = PROMPTS.filter(
    (p) => (takesByQuote.get(p.id) ?? []).length >= HIGH_TAKE_COUNT,
  ).map((p) => p.id);
  const singleTake = PROMPTS.filter((p) => (takesByQuote.get(p.id) ?? []).length === 1).map(
    (p) => p.id,
  );

  // Optional spot-check: transcribe one produced clip back and score it.
  let verify: { quoteId: string; take: string; score: number; snippet: string } | null = null;
  if (!flags.has('skip-verify') && takes.length > 0) {
    try {
      const sample = takes.find((take) => take.takeIndex === 1) ?? takes[0];
      const back = await transcribe(
        new Uint8Array(readFileSync(resolve(outDir, sample.outRelPath))),
        'audio/wav',
      );
      const backWords = wordsOf(back);
      const backTokens = backWords.flatMap((word) =>
        normalize(word.word ?? word.punctuated_word ?? ''),
      );
      const quoteText = PROMPTS.find((p) => p.id === sample.quoteId)?.text ?? '';
      const queryCounts = counts(normalize(quoteText));
      const backCounts = counts(backTokens);
      let intersection = 0;
      for (const [token, qty] of backCounts) {
        intersection += Math.min(qty, queryCounts.get(token) ?? 0);
      }
      const n = normalize(quoteText).length;
      const precision = backTokens.length ? intersection / backTokens.length : 0;
      const recall = n ? intersection / n : 0;
      const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
      verify = {
        quoteId: sample.quoteId,
        take: sample.outRelPath,
        score: Number(f1.toFixed(4)),
        snippet: backWords
          .slice(0, 24)
          .map((word) => word.punctuated_word ?? word.word ?? '')
          .join(' '),
      };
      console.log(
        `  · verify: ${sample.outRelPath} transcribes back to ${sample.quoteId} (F1 ${verify.score})`,
      );
    } catch (error) {
      console.log(
        `  · verify skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // manifest.json
  const manifest = {
    voice,
    voiceId,
    sourceFile,
    sourceDurationSec: Number(sourceDuration.toFixed(3)),
    deepgramModel: 'nova-3',
    generatedAt: new Date().toISOString(),
    threshold,
    snap,
    transcriptWordCount: words.length,
    transcriptTokenCount: tokens.length,
    buffers: {
      ...buffers,
      finalPad: FINAL_PAD_S,
      neighborMargin: NEIGHBOR_MARGIN_S,
      pauseGap: PAUSE_GAP_S,
    },
    totalTakes: takes.length,
    perQuoteCounts: Object.fromEntries(
      PROMPTS.map((p) => [p.id, (takesByQuote.get(p.id) ?? []).length]),
    ),
    flags: { noMatch, highCount, singleTake },
    crossQuoteRemoved: crossQuoteRemoved.map((candidate) => ({
      quoteId: candidate.quoteId,
      startTime: Number(candidate.startTime.toFixed(3)),
      endTime: Number(candidate.endTime.toFixed(3)),
      score: candidate.score,
    })),
    verify,
    takes,
  };
  writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // SUMMARY.md
  const summaryLines: string[] = [
    `# ${voiceId} take segmentation`,
    '',
    `- Source: \`${sourceFile}\` (${sourceDuration.toFixed(1)}s)`,
    `- Transcript: Deepgram nova-3, ${words.length} words (cache: \`deepgram-nova3.json\`)`,
    `- Match threshold: ${threshold} (ordered LCS F1 over a sliding window)`,
    `- Cut bounding: each cut is hard-bounded by the neighbouring transcript ` +
      `words (margin ${NEIGHBOR_MARGIN_S}s); final-word pad ${FINAL_PAD_S}s for ` +
      `Deepgram's under-reported word ends.`,
    `- Padding (head/tail, fills the gap only): head **${head}s**, tail **${tail}s** ` +
      `(${snap ? `measured head ${buffers.measuredHead ?? 'n/a'}s / tail ${buffers.measuredTail ?? 'n/a'}s` : 'tight (--no-snap)'}; ` +
      `floors ${MIN_HEAD_S}/${MIN_TAIL_S}s)`,
    `- Total takes produced: **${takes.length}**`,
    '',
    '## Takes per quote',
    '',
    '| Quote | Takes | Flag |',
    '| --- | --- | --- |',
  ];
  for (const prompt of PROMPTS) {
    const count = (takesByQuote.get(prompt.id) ?? []).length;
    const flag =
      count === 0 ? 'NO MATCH' : count >= HIGH_TAKE_COUNT ? 'HIGH — review' : '';
    summaryLines.push(`| ${prompt.id} | ${count} | ${flag} |`);
  }
  summaryLines.push('', '## Flags', '');
  summaryLines.push(
    noMatch.length ? `- 0 matches: ${noMatch.join(', ')}` : '- 0 matches: none',
  );
  summaryLines.push(
    highCount.length
      ? `- High count (>=${HIGH_TAKE_COUNT}): ${highCount.join(', ')}`
      : `- High count (>=${HIGH_TAKE_COUNT}): none`,
  );
  summaryLines.push(
    singleTake.length ? `- Single take (sanity-check): ${singleTake.join(', ')}` : '- Single take: none',
  );
  if (crossQuoteRemoved.length) {
    summaryLines.push(
      `- Cross-quote duplicates removed: ${crossQuoteRemoved.length} (shared phrasing; kept the better match)`,
    );
  }
  if (verify) {
    summaryLines.push(
      '',
      '## Verify',
      '',
      `- Re-transcribed \`${verify.take}\` → ${verify.quoteId} (F1 ${verify.score})`,
    );
  }
  summaryLines.push(
    '',
    '## Next step (maintainer)',
    '',
    `Cull each \`clip-NN/\` folder to the single best take, then place the keeper`,
    `at \`../${voice}/clip-NN.wav\` for \`humanness:human-clips\`. Nothing here was`,
    'uploaded, committed, or deployed.',
    '',
  );
  writeFileSync(resolve(outDir, 'SUMMARY.md'), `${summaryLines.join('\n')}`);

  console.log(
    `\n${voiceId}: ${takes.length} takes across ${PROMPTS.length - noMatch.length}/${PROMPTS.length} quotes → ${outDir}`,
  );
  if (noMatch.length) console.log(`  flagged (0 matches): ${noMatch.join(', ')}`);
  if (highCount.length) console.log(`  flagged (high count): ${highCount.join(', ')}`);
  console.log('  manifest.json + SUMMARY.md written. No upload/commit/deploy.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
