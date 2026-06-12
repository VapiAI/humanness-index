/// <reference types="bun" />
/**
 * Generate a model's arena clips: 4 source voices x 20 prompts = 80 MP3s,
 * named by the frozen content-hash scheme
 * sha256("{variantId}|{promptId}|settings-v3")[:32].mp3 where
 * variantId = `variant:{voiceId}:{providerId}:{arenaApiId}`.
 *
 *   bun run humanness:clips <model id|slug|provider/arenaApiId> [--upload]
 *       [--force] [--voices clara,emma] [--concurrency 4] [--limit N]
 *       [--no-remote-check]
 *
 * Clips land in pipeline/results/clips/{modelId}/ (gitignored) plus a
 * manifest.json. With --upload each clip is pushed to the Blob store
 * (skip-if-exists) and every expected hash is HEAD-verified at the end —
 * the pre-registration half of the "clips resolve before the registry
 * change" sequencing rule. Already-hosted clips are skipped unless --force.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { loadPipelineEnv, requireEnv } from './env';
import { clipHash, clipPublicUrl, looksLikeMp3, parseArgs, sleep, variantIdFor } from './lib';
import { resolvePipelineModel } from './models';
import { PROMPTS } from './prompts';
import { transportFor, RateLimitedError, type SynthesisResult } from './transports';
import { clipExistsRemotely, uploadClip } from './uploadClips';
import { requireVoiceMap, SOURCE_VOICE_IDS, type SourceVoiceId } from './voices';

const RESULTS_DIR = resolve(import.meta.dir, 'results');
/** An MP3 this small for a ~15 s prompt is an error payload, not audio. */
const MIN_CLIP_BYTES = 20_000;
const MAX_ATTEMPTS = 4;

type ClipJob = {
  voiceId: SourceVoiceId;
  promptId: string;
  text: string;
  variantId: string;
  hash: string;
  outPath: string;
};

type ClipRecord = {
  voiceId: string;
  promptId: string;
  variantId: string;
  hash: string;
  bytes: number;
  source: 'generated' | 'local-cache' | 'remote-exists';
  uploaded: boolean;
};

/**
 * Transcode non-MP3 transport output to the arena MP3 format via ffmpeg.
 * Uses temp files, NOT pipes: with piped stdio, ffmpeg blocks writing MP3
 * once the 64 KB stdout pipe fills while spawnSync is still feeding stdin —
 * a deadlock for any clip-length audio (hit on the first wave-2 WAV/PCM
 * providers; the wave-1 providers returned MP3 and never transcoded).
 */
const toMp3 = (audio: SynthesisResult): Uint8Array => {
  if (audio.format === 'mp3') return audio.bytes;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inPath = resolve(tmpdir(), `humanness-clip-${stamp}.in`);
  const outPath = resolve(tmpdir(), `humanness-clip-${stamp}.mp3`);
  const inputArgs =
    audio.format === 'pcm'
      ? ['-f', 's16le', '-ar', String(audio.sampleRate ?? 24000), '-ac', '1', '-i', inPath]
      : ['-i', inPath];
  try {
    writeFileSync(inPath, audio.bytes);
    const result = spawnSync('ffmpeg', [
      '-y',
      ...inputArgs,
      '-ac',
      '1',
      '-b:a',
      '128k',
      '-f',
      'mp3',
      outPath,
    ]);
    if (result.status !== 0 || !existsSync(outPath)) {
      throw new Error(
        `ffmpeg transcode failed: ${result.stderr?.toString().slice(-300)}`,
      );
    }
    const bytes = new Uint8Array(readFileSync(outPath));
    if (bytes.length === 0) throw new Error('ffmpeg transcode produced empty output');
    return bytes;
  } finally {
    rmSync(inPath, { force: true });
    rmSync(outPath, { force: true });
  }
};

const main = async (): Promise<void> => {
  loadPipelineEnv();
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  if (positionals.length !== 1) {
    console.error(
      'usage: bun run humanness:clips <model id|slug|provider/arenaApiId> ' +
        '[--upload] [--force] [--voices clara,emma] [--concurrency 4] [--limit N] ' +
        '[--no-remote-check]',
    );
    process.exit(2);
  }

  const model = resolvePipelineModel(positionals[0]);
  const transport = transportFor(model.providerId);
  if (!transport?.synthesize) {
    console.error(`no synthesis transport for provider ${model.providerId}`);
    process.exit(1);
  }
  const synthesize = transport.synthesize;
  const voiceMap = requireVoiceMap(model.providerId);

  const upload = flags.has('upload');
  const force = flags.has('force');
  // Skip the per-job remote-HEAD short-circuit (blob-origin fetches inside a
  // long-lived Bun process can wedge the event loop at 100% CPU on network
  // blips — observed 2026-06-12; upload separately, e.g.
  // results/upload-wave2.zsh, when running with this flag).
  const noRemoteCheck = flags.has('no-remote-check');
  const concurrency = Number(flags.get('concurrency') ?? 4);
  const limit = flags.has('limit') ? Number(flags.get('limit')) : Infinity;
  const voiceFilter = flags.has('voices')
    ? new Set(
        String(flags.get('voices'))
          .split(',')
          .map((value) => (value.startsWith('voice-') ? value : `voice-${value}`)),
      )
    : null;
  const blobToken = upload ? requireEnv('BLOB_READ_WRITE_TOKEN') : null;

  const clipsDir = resolve(RESULTS_DIR, 'clips', model.id);
  mkdirSync(clipsDir, { recursive: true });

  const voices = SOURCE_VOICE_IDS.filter(
    (voiceId) => !voiceFilter || voiceFilter.has(voiceId),
  );
  const jobs: ClipJob[] = [];
  for (const voiceId of voices) {
    for (const prompt of PROMPTS) {
      const variantId = variantIdFor(voiceId, model.providerId, model.arenaApiId);
      const hash = clipHash(variantId, prompt.id);
      jobs.push({
        voiceId,
        promptId: prompt.id,
        text: prompt.text,
        variantId,
        hash,
        outPath: resolve(clipsDir, `${hash}.mp3`),
      });
    }
  }

  console.log(
    `${model.id} (${model.providerId}/${model.arenaApiId}, vendor ${model.vendorModelId}): ` +
      `${jobs.length} clips → ${clipsDir}${upload ? ' (+upload)' : ''}`,
  );

  const records: ClipRecord[] = [];
  const failures: Array<{ job: ClipJob; error: string }> = [];
  let generatedCount = 0;
  let index = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const jobIndex = index;
      index += 1;
      if (jobIndex >= jobs.length) return;
      const job = jobs[jobIndex];

      try {
        let source: ClipRecord['source'] = 'generated';
        let bytes: Uint8Array | null = null;

        if (!force && existsSync(job.outPath)) {
          bytes = new Uint8Array(readFileSync(job.outPath));
          source = 'local-cache';
        } else if (!force && !noRemoteCheck && (await clipExistsRemotely(job.hash))) {
          source = 'remote-exists';
        } else {
          if (generatedCount >= limit) return;
          generatedCount += 1;
          let lastError: unknown = null;
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            try {
              const audio = await synthesize({
                vendorModelId: model.vendorModelId,
                providerVoiceId: voiceMap[job.voiceId],
                text: job.text,
              });
              bytes = toMp3(audio);
              lastError = null;
              break;
            } catch (error) {
              lastError = error;
              const backoffMs =
                error instanceof RateLimitedError ? 4000 * attempt : 1200 * attempt;
              await sleep(backoffMs);
            }
          }
          if (lastError !== null || bytes === null) {
            throw lastError ?? new Error('no audio produced');
          }
          if (!looksLikeMp3(bytes) || bytes.length < MIN_CLIP_BYTES) {
            rmSync(job.outPath, { force: true });
            throw new Error(
              `suspicious clip (${bytes.length} bytes, mp3=${looksLikeMp3(bytes)})`,
            );
          }
          writeFileSync(job.outPath, bytes);
        }

        let uploaded = false;
        if (upload && blobToken) {
          if (source === 'remote-exists') {
            uploaded = true;
          } else if (bytes) {
            await uploadClip(job.hash, bytes, blobToken);
            uploaded = true;
          }
        }

        records.push({
          voiceId: job.voiceId,
          promptId: job.promptId,
          variantId: job.variantId,
          hash: job.hash,
          bytes: bytes?.length ?? 0,
          source,
          uploaded,
        });
        console.log(
          `  ✓ ${job.voiceId} ${job.promptId} ${job.hash} [${source}${uploaded ? ', uploaded' : ''}]`,
        );
      } catch (error) {
        failures.push({
          job,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`  ✗ ${job.voiceId} ${job.promptId}: ${failures.at(-1)?.error}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker()),
  );

  // Final HEAD verification of every expected hash (the sequencing gate).
  const missingRemote: string[] = [];
  if (upload) {
    for (const job of jobs) {
      if (!(await clipExistsRemotely(job.hash))) {
        missingRemote.push(`${job.voiceId} ${job.promptId} → ${clipPublicUrl(job.hash)}`);
      }
    }
  }

  const manifest = {
    model: {
      id: model.id,
      providerId: model.providerId,
      arenaApiId: model.arenaApiId,
      vendorModelId: model.vendorModelId,
    },
    generatedAt: new Date().toISOString(),
    clipCount: records.length,
    failures: failures.map(({ job, error }) => ({
      voiceId: job.voiceId,
      promptId: job.promptId,
      error,
    })),
    clips: records.sort(
      (a, b) =>
        a.voiceId.localeCompare(b.voiceId) || a.promptId.localeCompare(b.promptId),
    ),
  };
  writeFileSync(
    resolve(clipsDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(
    `\n${model.id}: ${records.length}/${jobs.length} clips ok ` +
      `(${records.filter((record) => record.source === 'generated').length} generated, ` +
      `${records.filter((record) => record.source !== 'generated').length} cached/hosted), ` +
      `${failures.length} failures`,
  );
  if (upload) {
    if (missingRemote.length === 0) {
      console.log(`✓ all ${jobs.length} hashes resolve on the audio origin`);
    } else {
      console.error(`✗ ${missingRemote.length} hashes missing remotely:`);
      for (const line of missingRemote) console.error(`  ${line}`);
    }
  }
  process.exit(failures.length === 0 && missingRemote.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
