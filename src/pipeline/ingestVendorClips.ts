/// <reference types="bun" />
/**
 * Ingest a VENDOR-RENDERED clip set: a provider renders the 80 arena clips
 * (four cloned source voices x the 20 frozen prompts) with its own model and
 * supplies them, used where this pipeline has no API access (precedent:
 * Gradium; first use: Speechify Simba 3.2). This script stands in for
 * generateClips.ts: it validates the full 4x20 matrix, normalizes each clip
 * to the arena MP3 format (arenaNormalize.ts: trim, loudness to the field
 * median, mono 44.1 kHz 128 kbps), and uploads to the frozen content-hash
 * address.
 *
 *   bun run humanness:vendor-clips <model id|slug> <source-dir>              # validate + transcode locally
 *   bun run humanness:vendor-clips <model id|slug> <source-dir> --upload    # + upload (skip-if-exists) and HEAD-verify
 *
 * Source layout (both folder forms accepted; .wav/.flac/.mp3/.m4a):
 *   {source-dir}/voice-clara/clip-01..clip-20.mp3   (or clara/clip-01.mp3)
 *
 * It NEVER fabricates audio: the run fails unless every one of the 80
 * expected files is present (a partial vendor set is not a benchmarkable
 * model), and nothing is uploaded until the matrix is complete.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { toArenaMp3 } from './arenaNormalize';
import { loadPipelineEnv, requireEnv } from './env';
import { clipHash, parseArgs, variantIdFor } from './lib';
import { resolvePipelineModel } from './models';
import { PROMPTS } from './prompts';
import { uploadClip } from './uploadClips';
import { SOURCE_VOICE_IDS, type SourceVoiceId } from './voices';

const RESULTS_DIR = resolve(import.meta.dir, 'results');
const ACCEPTED_EXTENSIONS = ['wav', 'flac', 'mp3', 'm4a'];

/** The vendor file for a voice/prompt: `voice-clara/` or bare `clara/`. */
const findSourceFile = (
  sourceDir: string,
  voiceId: SourceVoiceId,
  promptId: string,
): string | null => {
  for (const folderName of [voiceId, voiceId.replace(/^voice-/, '')]) {
    const folder = resolve(sourceDir, folderName);
    if (!existsSync(folder)) continue;
    const match = readdirSync(folder).find((name) =>
      new RegExp(`^${promptId}\\.(${ACCEPTED_EXTENSIONS.join('|')})$`, 'i').test(name),
    );
    if (match) return resolve(folder, match);
  }
  return null;
};

const main = async (): Promise<void> => {
  loadPipelineEnv();
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  if (positionals.length !== 2) {
    console.error(
      'usage: bun run humanness:vendor-clips <model id|slug> <source-dir> [--upload]',
    );
    process.exit(2);
  }
  const model = resolvePipelineModel(positionals[0]);
  const sourceDir = resolve(positionals[1]);
  const upload = flags.has('upload');
  const blobToken = upload ? requireEnv('BLOB_READ_WRITE_TOKEN') : null;

  // Complete-matrix gate first: a vendor set is all-or-nothing.
  const jobs = SOURCE_VOICE_IDS.flatMap((voiceId) =>
    PROMPTS.map((prompt) => ({
      voiceId,
      promptId: prompt.id,
      hash: clipHash(
        variantIdFor(voiceId, model.providerId, model.arenaApiId),
        prompt.id,
      ),
      sourceFile: findSourceFile(sourceDir, voiceId, prompt.id),
    })),
  );
  const missing = jobs.filter((job) => !job.sourceFile);
  if (missing.length > 0) {
    console.error(
      `${model.id}: vendor set incomplete, ${missing.length}/${jobs.length} clips missing:`,
    );
    for (const job of missing) console.error(`  ${job.voiceId}/${job.promptId}`);
    process.exit(1);
  }

  const cacheDir = resolve(RESULTS_DIR, 'clips', model.id);
  mkdirSync(cacheDir, { recursive: true });
  console.log(
    `${model.id} (${model.providerId}/${model.arenaApiId}): ${jobs.length} vendor clips ` +
      `from ${sourceDir}${upload ? ' (+upload)' : ' (no upload; pass --upload)'}`,
  );

  const failures: string[] = [];
  const records: Array<{
    voiceId: string;
    promptId: string;
    hash: string;
    bytes: number;
    uploaded: string;
  }> = [];
  for (const job of jobs) {
    try {
      // Vendor renders get the plain normalize chain (no de-tap/denoise:
      // they are synthetic, not room recordings).
      const bytes = toArenaMp3(job.sourceFile!, null);
      writeFileSync(resolve(cacheDir, `${job.hash}.mp3`), bytes);
      let outcome = 'transcoded';
      if (upload && blobToken) {
        outcome = await uploadClip(job.hash, bytes, blobToken);
      }
      records.push({
        voiceId: job.voiceId,
        promptId: job.promptId,
        hash: job.hash,
        bytes: bytes.length,
        uploaded: outcome,
      });
      const mark = outcome === 'uploaded' ? '↑' : outcome === 'already-exists' ? '=' : '✓';
      console.log(`  ${mark} ${job.voiceId} ${job.promptId} ${job.hash} [${outcome}]`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${job.voiceId}/${job.promptId}: ${message}`);
      console.error(`  ✗ ${job.voiceId} ${job.promptId}: ${message}`);
    }
  }

  writeFileSync(
    resolve(cacheDir, 'manifest.json'),
    `${JSON.stringify(
      {
        model: {
          id: model.id,
          providerId: model.providerId,
          arenaApiId: model.arenaApiId,
          vendorModelId: model.vendorModelId,
        },
        source: 'vendor-rendered (ingestVendorClips.ts); normalized by arenaNormalize.ts',
        sourceDir,
        generatedAt: new Date().toISOString(),
        uploaded: upload,
        clips: records,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    `\n${model.id}: ${records.length}/${jobs.length} ingested, ${failures.length} failed` +
      `${upload ? ' (uploads HEAD-verified by uploadClip)' : ''}`,
  );
  if (upload && failures.length === 0) {
    console.log(
      `✓ all ${jobs.length} clips resolve on the audio origin; ` +
        `run \`bun run humanness:verify-clips ${model.id}\` after registering.`,
    );
  }
  process.exit(failures.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
