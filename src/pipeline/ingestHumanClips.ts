/// <reference types="bun" />
/**
 * Ingest the Human baseline recordings: the four source-voice actors reading
 * the same 20 arena lines (see HUMAN-RECORDING.md). Unlike every other model
 * these clips are NOT synthesized — real people recorded them — so this script
 * stands in for generateClips.ts: it reads the recordings, normalizes them to
 * the arena MP3 format, and uploads them to the frozen content-hash address.
 *
 *   bun run humanness:human-clips                 # report present/missing, transcode locally
 *   bun run humanness:human-clips --upload        # + upload (skip-if-exists) and HEAD-verify
 *   bun run humanness:human-clips --upload --overwrite   # re-upload re-records in place
 *   bun run humanness:human-clips --voices clara,emma    # limit to some voices
 *   bun run humanness:human-clips --detap                # de-tap (mic-bump high-pass + light adeclick) before normalize
 *   bun run humanness:human-clips --detap --denoise light # + gentle room-tone denoise (off|light|medium; --noise-floor <dB>)
 *   bun run humanness:human-clips --upload --skip-verify  # skip in-loop HEAD verify (avoids the Bun fetch wedge; HEAD-check separately)
 *
 * Source layout (one line per file; .wav/.flac/.mp3/.m4a all accepted):
 *   results/source-voices/human-readings/{clara,emma,godfrey,nelliot}/clip-01..clip-20.*
 *
 * Folder name -> voice id (clara -> voice-clara); filename clip-NN -> promptId
 * clip-NN. Each clip is addressed by the same frozen hash the rest of the
 * arena uses: sha256("variant:{voiceId}:human:human|{promptId}|settings-v3")[:32].
 *
 * It NEVER fabricates audio: a missing recording is reported as missing, not
 * filled with a placeholder (a placeholder would take the real clip's
 * skip-if-exists slot on the Blob origin and block the real upload later).
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

import { put } from '@vercel/blob';

import {
  cleanFilterChain,
  detapProfileForVoice,
  DENOISE_STRENGTHS,
  DEFAULT_NOISE_FLOOR_DB,
  type CleanOptions,
  type DenoiseStrength,
} from './audioClean';
import { loadPipelineEnv, requireEnv } from './env';
import {
  clipBlobPathname,
  clipHash,
  clipPublicUrl,
  looksLikeMp3,
  parseArgs,
  sleep,
  variantIdFor,
} from './lib';
import { resolvePipelineModel } from './models';
import { PROMPTS } from './prompts';
import { clipExistsRemotely } from './uploadClips';
import { SOURCE_VOICE_IDS, type SourceVoiceId } from './voices';

const RESULTS_DIR = resolve(import.meta.dir, 'results');
const READINGS_DIR = resolve(RESULTS_DIR, 'source-voices', 'human-readings');
const ACCEPTED_EXTENSIONS = ['wav', 'flac', 'mp3', 'm4a'];
/** An MP3 this small for a ~15 s line is an error payload, not audio. */
const MIN_CLIP_BYTES = 20_000;

type ClipStatus = 'missing' | 'transcoded' | 'uploaded' | 'already-exists' | 'failed';

type ClipResult = {
  voiceId: SourceVoiceId;
  promptId: string;
  hash: string;
  status: ClipStatus;
  sourceFile?: string;
  bytes?: number;
  error?: string;
};

/** The recording file for a voice/prompt, trying each accepted extension. */
const findSourceFile = (voiceId: SourceVoiceId, promptId: string): string | null => {
  const folder = resolve(READINGS_DIR, voiceId.replace(/^voice-/, ''));
  if (!existsSync(folder)) return null;
  const names = new Set(readdirSync(folder));
  for (const ext of ACCEPTED_EXTENSIONS) {
    const name = `${promptId}.${ext}`;
    if (names.has(name)) return resolve(folder, name);
  }
  // Tolerate case differences in the extension (e.g. clip-01.WAV).
  const match = readdirSync(folder).find((name) =>
    new RegExp(`^${promptId}\\.(${ACCEPTED_EXTENSIONS.join('|')})$`, 'i').test(name),
  );
  return match ? resolve(folder, match) : null;
};

/**
 * Loudness target for the Human clips, matched to the GENERATED set's MEDIAN
 * integrated loudness (EBU R128) so the human baseline sits in the field rather
 * than standing out. Measured 2026-06-13 across a representative Blob sample
 * (xAI Grok TTS + Streaming, Cartesia Sonic 3.5, ElevenLabs Flash v2.5, MiniMax
 * 2.5; 4 source voices x 3 prompts, n=60): median -24.7 LUFS (spread roughly
 * -31 to -19). The earlier -16 LUFS left the human clips ~7 LU louder than the
 * field. Future voices (Emma/Godfrey) inherit this target.
 */
const HUMAN_LUFS_TARGET = -24.7;
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
    `loudnorm=I=${HUMAN_LUFS_TARGET}:TP=${TRUE_PEAK_DBTP}:LRA=${LOUDNORM_LRA}:print_format=json`,
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
 * silence trimmed, loudness matched to HUMAN_LUFS_TARGET. Two passes:
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
const toArenaMp3 = (sourceFile: string, cleanOpts: CleanOptions | null): Uint8Array => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const wavPath = resolve(tmpdir(), `human-clip-${stamp}.wav`);
  const outPath = resolve(tmpdir(), `human-clip-${stamp}.mp3`);
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
      ? HUMAN_LUFS_TARGET + MP3_LOUDNESS_COMP_DB - measuredI
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

/**
 * Upload one normalized clip. Default is skip-if-exists (content-hash
 * addresses are immutable); --overwrite re-puts in place for re-records.
 * Verifies the public URL resolves afterwards, like uploadClips.ts.
 *
 * skipVerify avoids ALL blob-origin HEAD fetches (the skip-if-exists pre-check
 * AND the post-upload poll). Those fetches can wedge the Bun event loop at
 * 100% CPU on a network blip in a long-lived process (see generateClips.ts);
 * with skipVerify the run only PUTs, and the clips are HEAD-verified separately
 * afterwards (e.g. curl).
 */
const uploadHumanClip = async (
  hash: string,
  bytes: Uint8Array,
  token: string,
  overwrite: boolean,
  skipVerify: boolean,
): Promise<'uploaded' | 'already-exists'> => {
  if (!looksLikeMp3(bytes)) {
    throw new Error(`refusing to upload ${hash}: bytes are not an MP3 stream`);
  }
  if (!skipVerify && !overwrite && (await clipExistsRemotely(hash))) {
    return 'already-exists';
  }
  await put(clipBlobPathname(hash), Buffer.from(bytes), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'audio/mpeg',
    token,
    allowOverwrite: true,
    abortSignal: AbortSignal.timeout(120_000),
  });
  if (skipVerify) return 'uploaded';
  // Blob propagation to the public origin can lag the PUT by a few seconds.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await clipExistsRemotely(hash)) return 'uploaded';
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`uploaded ${hash} but the public URL does not resolve`);
};

const main = async (): Promise<void> => {
  loadPipelineEnv();
  const { flags } = parseArgs(process.argv.slice(2));
  const upload = flags.has('upload');
  const overwrite = flags.has('overwrite');
  const detap = flags.has('detap');
  const skipVerify = flags.has('skip-verify');
  const denoiseStrength = (
    flags.has('denoise') ? String(flags.get('denoise')) : 'off'
  ) as DenoiseStrength;
  const denoiseOn = denoiseStrength !== 'off' && denoiseStrength in DENOISE_STRENGTHS;
  const noiseFloorDb = flags.has('noise-floor')
    ? Number(flags.get('noise-floor'))
    : DEFAULT_NOISE_FLOOR_DB;
  // Denoise implies the de-tap chain too (the full clean pipeline).
  const cleaning = detap || denoiseOn;
  const voiceFilter = flags.has('voices')
    ? new Set(
        String(flags.get('voices'))
          .split(',')
          .map((value) => (value.startsWith('voice-') ? value : `voice-${value}`)),
      )
    : null;

  // Frozen ids come from the registry/pre-registration table, never hardcoded
  // twice (provider/arenaApiId both `human`).
  const model = resolvePipelineModel('human');
  const blobToken = upload ? requireEnv('BLOB_READ_WRITE_TOKEN') : null;

  const cacheDir = resolve(RESULTS_DIR, 'clips', model.id);
  mkdirSync(cacheDir, { recursive: true });

  const voices = SOURCE_VOICE_IDS.filter(
    (voiceId) => !voiceFilter || voiceFilter.has(voiceId),
  );

  console.log(
    `${model.id} (${model.providerId}/${model.arenaApiId}): ${voices.length * PROMPTS.length} ` +
      `clips expected from ${READINGS_DIR}${upload ? ' (+upload)' : ' (no upload; pass --upload)'}` +
      `${overwrite ? ' [overwrite]' : ''}${cleaning ? ' [detap]' : ''}` +
      `${denoiseOn ? ` [denoise:${denoiseStrength}]` : ''}`,
  );

  const results: ClipResult[] = [];
  for (const voiceId of voices) {
    for (const prompt of PROMPTS) {
      const variantId = variantIdFor(voiceId, model.providerId, model.arenaApiId);
      const hash = clipHash(variantId, prompt.id);
      const sourceFile = findSourceFile(voiceId, prompt.id);

      if (!sourceFile) {
        results.push({ voiceId, promptId: prompt.id, hash, status: 'missing' });
        console.log(`  · ${voiceId} ${prompt.id} ${hash} [missing recording]`);
        continue;
      }

      try {
        const cleanOpts: CleanOptions | null = cleaning
          ? {
              detap: { highpassHz: detapProfileForVoice(voiceId).highpassHz },
              denoise: denoiseOn
                ? { nrDb: DENOISE_STRENGTHS[denoiseStrength], nfDb: noiseFloorDb }
                : null,
            }
          : null;
        const bytes = toArenaMp3(sourceFile, cleanOpts);
        // Cache the normalized MP3 by its frozen hash for QA / re-upload.
        writeFileSync(resolve(cacheDir, `${hash}.mp3`), bytes);

        let status: ClipStatus = 'transcoded';
        if (upload && blobToken) {
          const outcome = await uploadHumanClip(hash, bytes, blobToken, overwrite, skipVerify);
          status = outcome;
        }
        results.push({
          voiceId,
          promptId: prompt.id,
          hash,
          status,
          sourceFile,
          bytes: bytes.length,
        });
        const mark = status === 'uploaded' ? '↑' : status === 'already-exists' ? '=' : '✓';
        console.log(`  ${mark} ${voiceId} ${prompt.id} ${hash} [${status}]`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          voiceId,
          promptId: prompt.id,
          hash,
          status: 'failed',
          sourceFile,
          error: message,
        });
        console.error(`  ✗ ${voiceId} ${prompt.id}: ${message}`);
      }
    }
  }

  const count = (status: ClipStatus) =>
    results.filter((result) => result.status === status).length;
  const missing = results.filter((result) => result.status === 'missing');

  writeFileSync(
    resolve(cacheDir, 'manifest.json'),
    `${JSON.stringify(
      {
        model: { id: model.id, providerId: model.providerId, arenaApiId: model.arenaApiId },
        generatedAt: new Date().toISOString(),
        uploaded: upload,
        overwrite,
        clips: results.sort(
          (a, b) =>
            a.voiceId.localeCompare(b.voiceId) || a.promptId.localeCompare(b.promptId),
        ),
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    `\n${model.id}: ${results.length} expected — ` +
      `${count('uploaded')} uploaded, ${count('already-exists')} already hosted, ` +
      `${count('transcoded')} ready (not uploaded), ${count('failed')} failed, ` +
      `${missing.length} missing recordings`,
  );
  if (missing.length > 0) {
    console.log('missing recordings (no file at the expected path):');
    for (const result of missing) {
      console.log(`  ${result.voiceId.replace(/^voice-/, '')}/${result.promptId}.{wav,flac,mp3,m4a}`);
    }
  }
  if (upload && missing.length === 0 && count('failed') === 0) {
    console.log(
      skipVerify
        ? '↑ all uploads issued (in-loop verify skipped; HEAD-check separately)'
        : '✓ all expected Human clips resolve on the audio origin',
    );
  }

  // Non-zero exit only on a hard failure; missing recordings are an expected
  // interim state (actors may still be recording), so they do not fail the run.
  process.exit(count('failed') === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
