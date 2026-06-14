/// <reference types="bun" />
/**
 * Shared audio-cleanup helpers for the Human baseline takes.
 *
 * The actors occasionally bump the mic/table, leaving a low-frequency "tap"
 * (a sub-fundamental thump, sometimes with a sharp onset click). These helpers
 * (a) DETECT those taps so we can target and verify them rather than guess, and
 * (b) remove them GENTLY without the "underwater" artifacts of broadband
 * denoise — this is a humanness benchmark, so naturalness comes first.
 *
 * Reused by detapTakes.ts (the A/B de-tap tool) and ingestHumanClips.ts
 * (`--detap`, baked into the upload step) so all four voices get identical
 * treatment.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { median } from './lib';

/** Default band we treat as "thump": a female vocal fundamental sits above this. */
export const LOW_BAND_HZ = 120;

/**
 * Per-voice tuning. Female fundamentals (~165-255 Hz) clear a 110 Hz corner, so
 * the high-pass is transparent. Male voices (Godfrey/Nelliot, ~85-180 Hz) sit
 * lower, so their corner and analysis bands drop accordingly — a female-tuned
 * 110 Hz high-pass would thin a male fundamental. The male corner is 70 Hz,
 * validated on Nelliot (fundamental floor ~88 Hz; the earlier provisional 80 Hz
 * thinned his low end). Godfrey reuses it and should still be re-checked against
 * his own takes (band energy + re-transcription) the way Clara/Nelliot were.
 */
export type VoiceDetapProfile = {
  highpassHz: number;
  lowBandHz: number;
  speechBandHz: number;
};

export const detapProfileForVoice = (voice: string): VoiceDetapProfile => {
  const name = voice.replace(/^voice-/, '');
  const male = name === 'godfrey' || name === 'nelliot';
  return male
    ? { highpassHz: 70, lowBandHz: 90, speechBandHz: 130 }
    : { highpassHz: 110, lowBandHz: LOW_BAND_HZ, speechBandHz: 150 };
};
/** RMS analysis frame (~46 ms at 44.1 kHz): long enough to hold a 120 Hz cycle. */
const FRAME_SAMPLES = 2048;
const SAMPLE_RATE = 44100;
const SILENCE_FLOOR_DB = -120;

export type DeTapOptions = {
  /** High-pass corner (Hz). Default 110 (gentle; below the female fundamental). */
  highpassHz?: number;
  /** High-pass poles: 2 = 12 dB/oct (gentle), 4 = 24 dB/oct (steeper). Default 2. */
  poles?: number;
  /** Include a light adeclick for the sharp onset click. Default true. */
  adeclick?: boolean;
};

/**
 * The de-tap filter fragment — NO loudness change, so it composes with the
 * ingest normalization chain. A gentle high-pass removes the sub-fundamental
 * thump; a light adeclick softens the impact onset. Returned as a string so it
 * can be prepended to any ffmpeg `-af` chain.
 *
 * `poles=4` is expressed as two cascaded biquads (ffmpeg highpass supports
 * poles 1-2 only); 2 -> one stage, 4 -> two stages.
 */
export const deTapFilterChain = (opts: DeTapOptions = {}): string => {
  const hp = opts.highpassHz ?? 110;
  const poles = opts.poles ?? 2;
  const stage = `highpass=f=${hp}:poles=2`;
  const stages = poles >= 4 ? [stage, stage] : [`highpass=f=${hp}:poles=${Math.max(1, poles)}`];
  if (opts.adeclick !== false) stages.push('adeclick=threshold=2');
  return stages.join(',');
};

export type Frame = { t: number; db: number };

const parseRmsDump = (text: string): Frame[] => {
  const frames: Frame[] = [];
  let t = 0;
  for (const line of text.split('\n')) {
    const tm = line.match(/pts_time:([\d.]+)/);
    if (tm) {
      t = Number.parseFloat(tm[1]);
      continue;
    }
    const rm = line.match(/RMS_level=(-?inf|-?[\d.]+)/);
    if (rm) {
      frames.push({
        t,
        db: rm[1].includes('inf') ? SILENCE_FLOOR_DB : Number.parseFloat(rm[1]),
      });
    }
  }
  return frames;
};

/** Per-frame RMS (dB) after an optional pre-filter (e.g. `lowpass=f=120`). */
export const perFrameRms = (file: string, prefilter: string): Frame[] => {
  const dump = resolve(tmpdir(), `rms-${Math.random().toString(36).slice(2, 9)}.txt`);
  const chain = [
    prefilter,
    `asetnsamples=n=${FRAME_SAMPLES}:p=0`,
    'astats=metadata=1:reset=1',
    `ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${dump}`,
  ]
    .filter(Boolean)
    .join(',');
  try {
    const result = spawnSync('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-af',
      chain,
      '-f',
      'null',
      '-',
    ]);
    if (result.status !== 0) {
      throw new Error(`ffmpeg astats failed: ${result.stderr?.toString().slice(-200)}`);
    }
    return parseRmsDump(readFileSync(dump, 'utf8'));
  } finally {
    rmSync(dump, { force: true });
  }
};

export type Tap = {
  /** Seconds (peak low-band frame). */
  time: number;
  /** Peak low-band RMS (dB). */
  lowDb: number;
  /** Speech-band (>150 Hz) RMS at the tap frame (dB). */
  speechDb: number;
  /** lowDb - speechDb: a TAP is low-band dominant (positive); voice is not. */
  dominanceDb: number;
  /** Low-band level during speech (dB) — the "speech low-band baseline". */
  baselineDb: number;
  /** lowDb - baselineDb (spike over the speech low-band level). */
  deltaDb: number;
  /** True when speech is active at the tap (harder to fully remove). */
  overlapsSpeech: boolean;
};

export type TapScan = {
  taps: Tap[];
  baselineDb: number;
  peakDeltaDb: number;
  low: Frame[];
};

export type TapScanOptions = {
  /**
   * How much louder the low band must be than the speech band to call a tap.
   * A voice is never low-band dominant, so this cleanly separates a thump from
   * speech (and from low-frequency vocal energy/plosives). Default 6.
   */
  dominanceDb?: number;
  /** Also require the low band to spike this far over its speech baseline. Default 4. */
  spikeDb?: number;
  /** Upper edge of the "thump" band (Hz). Default 120 (female). */
  lowBandHz?: number;
  /** Lower edge of the "speech" reference band (Hz). Default 150 (female). */
  speechBandHz?: number;
};

/**
 * Short transients whose energy is CONCENTRATED in the low band (louder there
 * than in the speech band) AND spike above the clip's speech-time low-band
 * level — i.e. mic/table thumps, not voice. Reports the speech level at each so
 * a caller can tell when a tap overlaps speech (those resist clean removal).
 */
export const detectTaps = (file: string, opts: TapScanOptions = {}): TapScan => {
  const dominanceDb = opts.dominanceDb ?? 6;
  const spikeDb = opts.spikeDb ?? 4;
  const lowBandHz = opts.lowBandHz ?? LOW_BAND_HZ;
  const speechBandHz = opts.speechBandHz ?? 150;
  const low = perFrameRms(file, `lowpass=f=${lowBandHz}`);
  const speech = perFrameRms(file, `highpass=f=${speechBandHz}`);
  const n = Math.min(low.length, speech.length);

  const activeSpeech = speech.slice(0, n).map((f) => f.db).filter((db) => db > -55);
  const speechMedian = activeSpeech.length ? median(activeSpeech) : SILENCE_FLOOR_DB;
  const lowDuringSpeech: number[] = [];
  for (let k = 0; k < n; k += 1) {
    if (speech[k].db > speechMedian - 10) lowDuringSpeech.push(low[k].db);
  }
  const baselineDb = lowDuringSpeech.length
    ? median(lowDuringSpeech)
    : median(low.map((f) => f.db));

  const isCandidate = (k: number): boolean =>
    low[k].db - speech[k].db >= dominanceDb && low[k].db - baselineDb >= spikeDb;

  const taps: Tap[] = [];
  let peakDeltaDb = 0;
  let i = 0;
  while (i < n) {
    if (isCandidate(i)) {
      let j = i;
      let peak = i;
      // Extend over the contiguous transient (relaxed bounds to catch the tails).
      while (
        j < n &&
        low[j].db - speech[j].db >= dominanceDb - 3 &&
        low[j].db - baselineDb >= spikeDb - 3
      ) {
        if (low[j].db > low[peak].db) peak = j;
        j += 1;
      }
      const deltaDb = low[peak].db - baselineDb;
      taps.push({
        time: low[peak].t,
        lowDb: low[peak].db,
        speechDb: speech[peak].db,
        dominanceDb: low[peak].db - speech[peak].db,
        baselineDb,
        deltaDb,
        overlapsSpeech: speech[peak].db > speechMedian - 6,
      });
      if (deltaDb > peakDeltaDb) peakDeltaDb = deltaDb;
      i = j;
    } else {
      i += 1;
    }
  }
  return { taps, baselineDb, peakDeltaDb, low };
};

/** Apply the de-tap chain and write a mono 44.1 kHz WAV (no loudness change). */
export const applyDeTap = (
  inPath: string,
  outPath: string,
  opts: DeTapOptions = {},
): void => {
  applyClean(inPath, outPath, { detap: opts });
};

/* ------------------------------ denoise (fuzz) --------------------------- */

/**
 * Gentle broadband-denoise strength -> afftdn `nr` (dB of bounded reduction).
 * The reduction is CAPPED at this many dB per frequency bin, so breaths and
 * sibilants (which sit above the noise floor) survive — the point is to make
 * the room-tone hiss unobtrusive, NOT studio-silent.
 *
 * We use ffmpeg afftdn rather than sox `noisered`: tested against a profile of
 * Clara's own room tone, noisered over-subtracted the matched hiss to ~-80 dB
 * (studio-silent) even at low factors and gave little gentle control, which
 * fought the "still sounds like a real person in a quiet room" goal. afftdn's
 * bounded `nr`, with `nf` matched to the measured room-tone floor, gives the
 * gentle, tunable, breath-safe reduction this benchmark needs.
 */
export const DENOISE_STRENGTHS = { off: 0, light: 6, medium: 12 } as const;
export type DenoiseStrength = keyof typeof DENOISE_STRENGTHS;

/** Room-tone floor (dB) used for afftdn `nf` when not measured (female default). */
export const DEFAULT_NOISE_FLOOR_DB = -44;

export type DenoiseOptions = {
  /** afftdn noise reduction cap (dB). */
  nrDb: number;
  /** afftdn noise floor (dB), matched to the measured room tone. */
  nfDb?: number;
};

export type CleanOptions = {
  detap?: DeTapOptions;
  /** Omit/null for de-tap only (no denoise). */
  denoise?: DenoiseOptions | null;
};

/**
 * The full cleaning filter fragment (no loudness change), composable with the
 * ingest normalize chain. afftdn runs BEFORE the de-tap high-pass on purpose:
 * with `nf` matched to the full-band room-tone RMS the reduction stays bounded
 * and natural; running it after the high-pass (floor already lowered) makes `nf`
 * too high and over-cuts.
 */
export const cleanFilterChain = (opts: CleanOptions = {}): string => {
  const parts: string[] = [];
  if (opts.denoise && opts.denoise.nrDb > 0) {
    const nf = opts.denoise.nfDb ?? DEFAULT_NOISE_FLOOR_DB;
    parts.push(`afftdn=nf=${nf}:nr=${opts.denoise.nrDb}`);
  }
  parts.push(deTapFilterChain(opts.detap));
  return parts.join(',');
};

/** Apply the full clean chain and write a mono 44.1 kHz WAV (no loudness change). */
export const applyClean = (
  inPath: string,
  outPath: string,
  opts: CleanOptions = {},
): void => {
  const result = spawnSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-nostats',
    '-i',
    inPath,
    '-af',
    cleanFilterChain(opts),
    '-ac',
    '1',
    '-ar',
    String(SAMPLE_RATE),
    outPath,
  ]);
  if (result.status !== 0) {
    throw new Error(`ffmpeg clean failed: ${result.stderr?.toString().slice(-300)}`);
  }
};

export type RoomTone = { startSec: number; durSec: number; floorDb: number };

/**
 * Find this recording's own room tone: the longest speech-free stretch in the
 * SOURCE (per-frame RMS below a no-speech threshold), returning its centre
 * ~1.2 s and the median room-tone level (dB) to use as afftdn `nf`.
 */
export const findRoomTone = (
  sourceFile: string,
  noSpeechDb = -38,
): RoomTone | null => {
  const frames = perFrameRms(sourceFile, '');
  if (frames.length < 4) return null;
  const frameDur = frames[1].t - frames[0].t || FRAME_SAMPLES / SAMPLE_RATE;
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i].db < noSpeechDb) {
      if (curStart < 0) curStart = i;
      curLen += 1;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  const minFrames = Math.ceil(0.8 / frameDur);
  if (bestStart < 0 || bestLen < minFrames) return null;
  const floorDb = median(
    frames.slice(bestStart, bestStart + bestLen).map((f) => f.db),
  );
  // Centre ~1.2 s inside the gap (away from speech edges/breaths).
  const wantFrames = Math.min(bestLen, Math.round(1.2 / frameDur));
  const offset = Math.floor((bestLen - wantFrames) / 2);
  return {
    startSec: Number(frames[bestStart + offset].t.toFixed(3)),
    durSec: Number((wantFrames * frameDur).toFixed(3)),
    floorDb: Number(floorDb.toFixed(1)),
  };
};

/** Quietest windowed RMS of a file (dB) — the in-context noise floor. */
export const rmsTroughDb = (file: string): number => {
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    'astats=metadata=0',
    '-f',
    'null',
    '-',
  ]);
  const match = result.stderr?.toString().match(/RMS trough dB:\s*(-?inf|-?[\d.]+)/);
  if (!match) return SILENCE_FLOOR_DB;
  return match[1].includes('inf') ? SILENCE_FLOOR_DB : Number.parseFloat(match[1]);
};

/** Overall RMS level (dB) of a whole file — a loudness-consistency check. */
export const overallRmsDb = (file: string): number => {
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    'astats=metadata=0',
    '-f',
    'null',
    '-',
  ]);
  const match = result.stderr
    ?.toString()
    .match(/RMS level dB:\s*(-?inf|-?[\d.]+)/);
  if (!match) return SILENCE_FLOOR_DB;
  return match[1].includes('inf') ? SILENCE_FLOOR_DB : Number.parseFloat(match[1]);
};
