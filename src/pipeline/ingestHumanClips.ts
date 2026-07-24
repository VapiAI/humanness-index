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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import { put } from '@vercel/blob';

import { toArenaMp3 } from './arenaNormalize';
import {
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

// The normalization chain (trim + measured single-gain loudnorm to the arena
// field median + true-peak limit + mono 44.1 kHz 128 kbps MP3) lives in
// arenaNormalize.ts (toArenaMp3), shared with the vendor-render ingest.

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
