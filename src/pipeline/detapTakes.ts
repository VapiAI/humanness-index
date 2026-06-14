/// <reference types="bun" />
/**
 * Clean the culled Human-baseline takes for A/B audition: de-tap (mic/table
 * thump removal) plus an OPTIONAL gentle broadband denoise for the steady
 * room-tone "fuzz".
 *
 *   bun run humanness:human-detap <voice> [--denoise off|light|medium]
 *       [--dominance 6] [--spike 4] [--highpass 110] [--poles 2] [--no-adeclick]
 *       [--noise-floor <dB>]
 *
 * For each clip-NN/ folder under
 *   results/source-voices/human-readings/<voice>-takes/
 * it finds the single culled WAV (flagging any folder with 0 or >1 files),
 * detects low-band "tap" transients, applies the clean chain, and writes a copy
 * to a PARALLEL folder, leaving the originals (and the de-tap-only copies)
 * untouched:
 *   --denoise off     -> <voice>-takes-clean         (de-tap only)
 *   --denoise light   -> <voice>-takes-clean-light   (de-tap + gentle denoise)
 *   --denoise medium  -> <voice>-takes-clean-medium  (de-tap + a bit more)
 *
 * The denoise floor (afftdn nf) is matched to THIS recording's own room tone,
 * found in the SOURCE recording (manifest.sourceFile). Nothing is uploaded.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  applyClean,
  cleanFilterChain,
  detapProfileForVoice,
  detectTaps,
  findRoomTone,
  overallRmsDb,
  perFrameRms,
  rmsTroughDb,
  DENOISE_STRENGTHS,
  DEFAULT_NOISE_FLOOR_DB,
  type DeTapOptions,
  type DenoiseOptions,
  type DenoiseStrength,
} from './audioClean';
import { median, parseArgs } from './lib';
import { PROMPTS } from './prompts';

const RESULTS_DIR = resolve(import.meta.dir, 'results');
const READINGS_DIR = resolve(RESULTS_DIR, 'source-voices', 'human-readings');
const VOICES = ['clara', 'emma', 'godfrey', 'nelliot'];
/** Residual low-band spike (dB over the cleaned baseline) we still call audible. */
const RESIDUAL_AUDIBLE_DB = 4;
/** A drop this large (dB) at the tap counts as substantially removed. */
const MIN_DROP_DB = 8;

type TapReport = {
  time: number;
  beforeLowDb: number;
  afterLowDb: number;
  dropDb: number;
  dominanceDb: number;
  speechDb: number;
  overlapsSpeech: boolean;
  removed: boolean;
};

type ClipReport = {
  quoteId: string;
  sourceFile: string | null;
  fileCount: number;
  taps: TapReport[];
  rmsBeforeDb: number;
  rmsAfterDb: number;
  noiseFloorOrigDb: number;
  noiseFloorDetapDb: number | null;
  noiseFloorCleanDb: number;
  speechBandDeltaDb: number;
  recommendReTake: boolean;
};

const findSingleWav = (dir: string): { file: string | null; count: number } => {
  if (!existsSync(dir)) return { file: null, count: 0 };
  const wavs = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.wav'));
  return { file: wavs.length === 1 ? resolve(dir, wavs[0]) : null, count: wavs.length };
};

const speechBandRmsDb = (file: string): number => {
  const frames = perFrameRms(file, 'highpass=f=150');
  const active = frames.map((f) => f.db).filter((db) => db > -45);
  return active.length ? median(active) : -120;
};

const main = (): void => {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  if (positionals.length !== 1 || !VOICES.includes(positionals[0])) {
    console.error(
      `usage: bun run humanness:human-detap <${VOICES.join('|')}> ` +
        '[--denoise off|light|medium] [--dominance 6] [--spike 4] ' +
        '[--highpass 110] [--poles 2] [--no-adeclick] [--noise-floor <dB>]',
    );
    process.exit(2);
  }
  const voice = positionals[0];
  const strength = (flags.has('denoise') ? String(flags.get('denoise')) : 'off') as DenoiseStrength;
  if (!(strength in DENOISE_STRENGTHS)) {
    console.error(`--denoise must be one of: ${Object.keys(DENOISE_STRENGTHS).join(', ')}`);
    process.exit(2);
  }

  const profile = detapProfileForVoice(voice);
  const dominanceDb = flags.has('dominance') ? Number(flags.get('dominance')) : 6;
  const spikeDb = flags.has('spike') ? Number(flags.get('spike')) : 4;
  const lowBandHz = flags.has('low-band') ? Number(flags.get('low-band')) : profile.lowBandHz;
  const speechBandHz = profile.speechBandHz;
  const detap: DeTapOptions = {
    highpassHz: flags.has('highpass') ? Number(flags.get('highpass')) : profile.highpassHz,
    poles: flags.has('poles') ? Number(flags.get('poles')) : 2,
    adeclick: !flags.has('no-adeclick'),
  };

  const srcDir = resolve(READINGS_DIR, `${voice}-takes`);
  const detapOnlyDir = resolve(READINGS_DIR, `${voice}-takes-clean`);
  const cleanDir = resolve(
    READINGS_DIR,
    strength === 'off' ? `${voice}-takes-clean` : `${voice}-takes-clean-${strength}`,
  );
  if (!existsSync(srcDir)) {
    console.error(`culled takes not found: ${srcDir}`);
    process.exit(1);
  }
  mkdirSync(cleanDir, { recursive: true });

  // Build the denoise floor (nf) from this recording's own room tone.
  let denoise: DenoiseOptions | null = null;
  let roomTone: { startSec: number; durSec: number; floorDb: number } | null = null;
  if (strength !== 'off') {
    let nf = flags.has('noise-floor') ? Number(flags.get('noise-floor')) : DEFAULT_NOISE_FLOOR_DB;
    const manifestPath = resolve(srcDir, 'manifest.json');
    if (!flags.has('noise-floor') && existsSync(manifestPath)) {
      try {
        const src = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { sourceFile?: string }).sourceFile;
        if (src && existsSync(src)) {
          roomTone = findRoomTone(src);
          if (roomTone) nf = roomTone.floorDb;
        }
      } catch {
        // fall back to default nf
      }
    }
    denoise = { nrDb: DENOISE_STRENGTHS[strength], nfDb: nf };
  }

  const filterChain = cleanFilterChain({ detap, denoise });
  console.log(`clean ${voice} (denoise=${strength}): ${srcDir} -> ${cleanDir}`);
  if (roomTone) {
    console.log(
      `  room tone: ${roomTone.durSec}s @ ${roomTone.startSec}s in source, floor ${roomTone.floorDb} dB -> afftdn nf`,
    );
  }
  console.log(`  filter: "${filterChain}"\n`);

  const clips: ClipReport[] = [];
  for (const prompt of PROMPTS) {
    const { file, count } = findSingleWav(resolve(srcDir, prompt.id));
    if (!file) {
      console.log(`  ! ${prompt.id}: ${count} WAV files (expected 1) — skipped, FLAG`);
      clips.push({
        quoteId: prompt.id, sourceFile: null, fileCount: count, taps: [],
        rmsBeforeDb: 0, rmsAfterDb: 0, noiseFloorOrigDb: 0, noiseFloorDetapDb: null,
        noiseFloorCleanDb: 0, speechBandDeltaDb: 0, recommendReTake: false,
      });
      continue;
    }

    const scan = detectTaps(file, { dominanceDb, spikeDb, lowBandHz, speechBandHz });
    const outPath = resolve(cleanDir, `${prompt.id}.wav`);
    applyClean(file, outPath, { detap, denoise });

    // Tap removal: before/after low-band energy at each tap timestamp.
    const cleanLow = perFrameRms(outPath, `lowpass=f=${lowBandHz}`);
    const cleanByT = new Map(cleanLow.map((f) => [f.t.toFixed(3), f.db]));
    const cleanBaseline = median(cleanLow.map((f) => f.db));
    const taps: TapReport[] = scan.taps.map((tap) => {
      const afterLowDb = cleanByT.get(tap.time.toFixed(3)) ?? cleanBaseline;
      const residualDeltaDb = afterLowDb - cleanBaseline;
      const dropDb = tap.lowDb - afterLowDb;
      const removed = dropDb >= MIN_DROP_DB || residualDeltaDb < RESIDUAL_AUDIBLE_DB;
      return {
        time: Number(tap.time.toFixed(3)),
        beforeLowDb: Number(tap.lowDb.toFixed(1)),
        afterLowDb: Number(afterLowDb.toFixed(1)),
        dropDb: Number(dropDb.toFixed(1)),
        dominanceDb: Number(tap.dominanceDb.toFixed(1)),
        speechDb: Number(tap.speechDb.toFixed(1)),
        overlapsSpeech: tap.overlapsSpeech,
        removed,
      };
    });

    // Noise floor (quietest window) before/after; de-tap-only reference if present.
    const noiseFloorOrigDb = Number(rmsTroughDb(file).toFixed(1));
    const noiseFloorCleanDb = Number(rmsTroughDb(outPath).toFixed(1));
    const detapRef = resolve(detapOnlyDir, `${prompt.id}.wav`);
    const noiseFloorDetapDb =
      strength !== 'off' && existsSync(detapRef) ? Number(rmsTroughDb(detapRef).toFixed(1)) : null;
    const speechBandDeltaDb = Number((speechBandRmsDb(outPath) - speechBandRmsDb(file)).toFixed(2));

    const recommendReTake = taps.some((t) => t.overlapsSpeech && !t.removed);
    clips.push({
      quoteId: prompt.id,
      sourceFile: file.split('/').pop() ?? file,
      fileCount: count,
      taps,
      rmsBeforeDb: Number(overallRmsDb(file).toFixed(2)),
      rmsAfterDb: Number(overallRmsDb(outPath).toFixed(2)),
      noiseFloorOrigDb,
      noiseFloorDetapDb,
      noiseFloorCleanDb,
      speechBandDeltaDb,
      recommendReTake,
    });

    const ref = noiseFloorDetapDb === null ? noiseFloorOrigDb : noiseFloorDetapDb;
    const refLabel = noiseFloorDetapDb === null ? 'orig' : 'detap';
    console.log(
      `  ${recommendReTake ? '!' : '·'} ${prompt.id}: ${taps.length} tap(s), ` +
        `noise floor ${ref}(${refLabel})→${noiseFloorCleanDb} dB, speechΔ ${speechBandDeltaDb} dB`,
    );
  }

  const affected = clips.filter((c) => c.taps.length > 0).map((c) => c.quoteId);
  const reTakes = clips.filter((c) => c.recommendReTake).map((c) => c.quoteId);
  const missing = clips.filter((c) => c.fileCount !== 1).map((c) => c.quoteId);
  const totalTaps = clips.reduce((sum, c) => sum + c.taps.length, 0);
  const denoiseDrops = clips
    .filter((c) => c.fileCount === 1 && c.noiseFloorDetapDb !== null)
    .map((c) => (c.noiseFloorDetapDb as number) - c.noiseFloorCleanDb);
  const avgDenoiseDrop = denoiseDrops.length
    ? Number((denoiseDrops.reduce((s, v) => s + v, 0) / denoiseDrops.length).toFixed(1))
    : null;
  const maxSpeechDelta = Math.max(0, ...clips.map((c) => Math.abs(c.speechBandDeltaDb)));

  const report = {
    voice,
    generatedAt: new Date().toISOString(),
    sourceDir: srcDir,
    cleanDir,
    denoise: strength,
    filterChain,
    roomTone,
    options: { ...detap, dominanceDb, spikeDb, lowBandHz, speechBandHz, denoise },
    summary: {
      clips: PROMPTS.length,
      cleaned: clips.filter((c) => c.fileCount === 1).length,
      affectedClips: affected,
      totalTaps,
      reTakeClips: reTakes,
      fileCountFlags: missing,
      avgDenoiseDropDb: avgDenoiseDrop,
      maxSpeechBandDeltaDb: Number(maxSpeechDelta.toFixed(2)),
    },
    clips,
  };
  writeFileSync(resolve(cleanDir, 'clean-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  const lines: string[] = [
    `# ${voice} clean (denoise=${strength}) — A/B copies`,
    '',
    `- Source (untouched): \`${srcDir}\``,
    `- A/B copies: \`${cleanDir}/clip-NN.wav\``,
    `- De-tap-only reference (untouched): \`${detapOnlyDir}/clip-NN.wav\``,
    `- Filter chain: \`${filterChain}\` (no loudness change)`,
    roomTone
      ? `- Denoise: afftdn nf=${roomTone.floorDb} dB (measured room tone, ${roomTone.durSec}s @ ${roomTone.startSec}s), nr=${DENOISE_STRENGTHS[strength]} dB (bounded reduction, breath-safe)`
      : `- Denoise: ${strength === 'off' ? 'none (de-tap only)' : `afftdn nr=${DENOISE_STRENGTHS[strength]} dB (default nf)`}`,
    avgDenoiseDrop !== null
      ? `- Avg noise-floor reduction from denoise (vs de-tap-only): **${avgDenoiseDrop} dB**`
      : '',
    `- Max speech-band (>150 Hz) change: ${report.summary.maxSpeechBandDeltaDb} dB (voice preserved)`,
    `- Clips with taps: ${affected.length ? affected.join(', ') : 'none'} (total ${totalTaps})`,
    `- Re-take candidates: ${reTakes.length ? reTakes.join(', ') : 'none'}`,
    `- File-count flags: ${missing.length ? missing.join(', ') : 'none'}`,
    '',
    '## Noise floor (quietest window RMS, dB)',
    '',
    '| Clip | orig | de-tap only | this strength | denoise Δ |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const c of clips) {
    if (c.fileCount !== 1) continue;
    const det = c.noiseFloorDetapDb === null ? '—' : String(c.noiseFloorDetapDb);
    const dDelta =
      c.noiseFloorDetapDb === null ? '—' : (c.noiseFloorDetapDb - c.noiseFloorCleanDb).toFixed(1);
    lines.push(`| ${c.quoteId} | ${c.noiseFloorOrigDb} | ${det} | ${c.noiseFloorCleanDb} | ${dDelta} |`);
  }
  lines.push(
    '',
    '## Next step (maintainer)',
    '',
    'Audition `-light` vs `-medium` (vs the de-tap-only reference) and pick a',
    'strength. Then bake it into the upload via',
    '`humanness:human-clips --detap --denoise <strength>`.',
    'Nothing here was uploaded, committed, or deployed.',
    '',
  );
  writeFileSync(resolve(cleanDir, 'CLEAN-SUMMARY.md'), lines.join('\n'));

  console.log(
    `\n${voice} (denoise=${strength}): ${report.summary.cleaned}/${PROMPTS.length} cleaned, ` +
      `${affected.length} had taps, ${reTakes.length} re-take candidate(s)` +
      (avgDenoiseDrop !== null ? `, avg denoise drop ${avgDenoiseDrop} dB` : '') +
      `, max speechΔ ${report.summary.maxSpeechBandDeltaDb} dB. → ${cleanDir}`,
  );
  if (missing.length) console.log(`  FLAG file count: ${missing.join(', ')}`);
  console.log('  clean-report.json + CLEAN-SUMMARY.md written. No upload/commit/deploy.');
};

main();
