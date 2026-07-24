/// <reference types="bun" />
/**
 * Shared arena MP3 normalization for clips that are NOT synthesized by this
 * pipeline (the Human baseline recordings, vendor-rendered clip sets). One
 * chain, one loudness target, so every externally produced clip sits in the
 * generated field instead of standing out. Extracted from
 * ingestHumanClips.ts so ingestVendorClips.ts reuses it verbatim.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { cleanFilterChain, type CleanOptions } from './audioClean';
import { looksLikeMp3 } from './lib';

/**
 * Loudness target for ingested clips, matched to the GENERATED set's MEDIAN
 * integrated loudness (EBU R128) so ingested audio sits in the field rather
 * than standing out. Measured 2026-06-13 across a representative Blob sample
 * (xAI Grok TTS + Streaming, Cartesia Sonic 3.5, ElevenLabs Flash v2.5, MiniMax
 * 2.5; 4 source voices x 3 prompts, n=60): median -24.7 LUFS (spread roughly
 * -31 to -19). The earlier -16 LUFS left the human clips ~7 LU louder than the
 * field. All ingested clip sets inherit this target.
 */
export const ARENA_LUFS_TARGET = -24.7;
const TRUE_PEAK_DBTP = -1.5;
const LOUDNORM_LRA = 11;
/**
 * True-peak limiter ceiling as a linear sample-peak amplitude (~-2.0 dBFS). After
 * the loudness gain, alimiter tames only the hot transients (so a high-crest clip
 * keeps its loudness instead of being pushed quiet); -2.0 dBFS sample keeps the
 * encoded true peak under the -1.5 dBTP ceiling (verified true peaks <= -2.3 dBTP).
 */
const TP_LIMIT_LINEAR = 0.794;
/**
 * 128 kbps MP3 encoding measures ~0.45 LU quieter than its source WAV (verified
 * across clips). The generated-set median target is itself an MP3 measurement,
 * so we add this back to the pre-encode gain to land the ENCODED clip on target.
 */
const MP3_LOUDNESS_COMP_DB = 0.45;

/** An MP3 this small for a ~15 s line is an error payload, not audio. */
export const MIN_CLIP_BYTES = 20_000;

/**
 * Trim leading then trailing silence (reverse, trim the new leading edge,
 * reverse back). The narrow leading-only trims preserve natural mid-line pauses
 * ("...", "um"); only the dead air at the very head and tail is cut. Loudness is
 * NOT applied here — it is a precise two-pass loudnorm step in toArenaMp3.
 */
const TRIM_LEADING =
  'silenceremove=start_periods=1:start_silence=0.06:start_threshold=-45dB';
const TRIM_CHAIN = [TRIM_LEADING, 'areverse', TRIM_LEADING, 'areverse'].join(',');

/** Measured input loudness (loudnorm pass 1, print_format=json). */
const measureLoudnorm = (
  file: string,
): { i: string; tp: string; lra: string; thresh: string } => {
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    `loudnorm=I=${ARENA_LUFS_TARGET}:TP=${TRUE_PEAK_DBTP}:LRA=${LOUDNORM_LRA}:print_format=json`,
    '-f',
    'null',
    '-',
  ]);
  const log = result.stderr?.toString() ?? '';
  const grab = (key: string): string => {
    const match = log.match(new RegExp(`"${key}"\\s*:\\s*"(-?[0-9.]+|-?inf)"`));
    if (!match) throw new Error(`loudnorm measure: ${key} not found`);
    return match[1];
  };
  return {
    i: grab('input_i'),
    tp: grab('input_tp'),
    lra: grab('input_lra'),
    thresh: grab('input_thresh'),
  };
};

/**
 * Normalize a recording to the arena MP3 format: mono, 44.1 kHz, leading/trailing
 * silence trimmed, loudness matched to ARENA_LUFS_TARGET. Two passes:
 *  1. clean (optional de-tap/denoise) + trim -> temp WAV,
 *  2. measure its loudness (EBU R128), apply ONE linear gain to the target, then
 *     a true-peak limiter to hold the ceiling.
 *
 * A single linear gain is used rather than loudnorm's dynamic/linear mode because
 * integrated loudness shifts by EXACTLY the applied dB, so the target is hit
 * precisely. The true-peak limiter (alimiter) then tames only the hot transients
 * rather than reducing the whole clip, so a high-crest clip keeps its loudness
 * (loudnorm's two-pass undershot these; a plain gain+TP-cap gutted them).
 *
 * Cleaning runs BEFORE trim/gain so the room-tone fuzz and mic-bump thump are
 * gone before levels are set; the de-tap corner is per-voice (see
 * detapProfileForVoice) so a male fundamental is never thinned. `-filter_threads 1`
 * keeps ffmpeg 7's multi-threaded filter scheduler off a multi-stage graph that
 * can otherwise assert intermittently.
 */
export const toArenaMp3 = (
  sourceFile: string,
  cleanOpts: CleanOptions | null,
): Uint8Array => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const wavPath = resolve(tmpdir(), `arena-clip-${stamp}.wav`);
  const outPath = resolve(tmpdir(), `arena-clip-${stamp}.mp3`);
  const preChain = cleanOpts ? `${cleanFilterChain(cleanOpts)},${TRIM_CHAIN}` : TRIM_CHAIN;
  try {
    const stage1 = spawnSync('ffmpeg', [
      '-y', '-filter_threads', '1', '-i', sourceFile, '-af', preChain,
      '-ac', '1', '-ar', '44100', wavPath,
    ]);
    if (stage1.status !== 0 || !existsSync(wavPath)) {
      throw new Error(`ffmpeg clean/trim failed: ${stage1.stderr?.toString().slice(-400)}`);
    }
    const measuredI = Number(measureLoudnorm(wavPath).i);
    const gainDb = Number.isFinite(measuredI)
      ? ARENA_LUFS_TARGET + MP3_LOUDNESS_COMP_DB - measuredI
      : 0;
    const stage2 = spawnSync('ffmpeg', [
      '-y', '-filter_threads', '1', '-i', wavPath, '-af',
      `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${TP_LIMIT_LINEAR}:level=false`,
      '-ac', '1', '-ar', '44100', '-b:a', '128k', '-f', 'mp3', outPath,
    ]);
    if (stage2.status !== 0 || !existsSync(outPath)) {
      throw new Error(`ffmpeg gain/limit/encode failed: ${stage2.stderr?.toString().slice(-400)}`);
    }
    const bytes = new Uint8Array(readFileSync(outPath));
    if (!looksLikeMp3(bytes) || bytes.length < MIN_CLIP_BYTES) {
      throw new Error(
        `suspicious output (${bytes.length} bytes, mp3=${looksLikeMp3(bytes)})`,
      );
    }
    return bytes;
  } finally {
    rmSync(wavPath, { force: true });
    rmSync(outPath, { force: true });
  }
};
