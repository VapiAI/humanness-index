/// <reference types="bun" />
/**
 * Upload clip MP3s to the project Blob store under audio/{hash}.mp3 with
 * skip-if-exists semantics (a clip's content-hash address is immutable, so
 * an existing blob never needs rewriting).
 *
 *   bun run src/pipeline/uploadClips.ts <file-or-dir ...>
 *
 * Files must be named {32-hex-hash}.mp3 (generateClips.ts output). Requires
 * BLOB_READ_WRITE_TOKEN in pipeline/.env.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { put } from '@vercel/blob';

import { loadPipelineEnv, requireEnv } from './env';
import { clipBlobPathname, clipPublicUrl, looksLikeMp3, sleep } from './lib';

const HASH_FILE_PATTERN = /^[0-9a-f]{32}\.mp3$/;

export type UploadOutcome = 'uploaded' | 'already-exists';

export const clipExistsRemotely = async (hash: string): Promise<boolean> => {
  const response = await fetch(clipPublicUrl(hash), {
    method: 'HEAD',
    signal: AbortSignal.timeout(30_000),
  });
  return response.ok;
};

/** Upload one clip; verifies the public URL resolves afterwards. */
export const uploadClip = async (
  hash: string,
  bytes: Uint8Array,
  token: string,
): Promise<UploadOutcome> => {
  if (!looksLikeMp3(bytes)) {
    throw new Error(`refusing to upload ${hash}: bytes are not an MP3 stream`);
  }
  if (await clipExistsRemotely(hash)) return 'already-exists';
  await put(clipBlobPathname(hash), Buffer.from(bytes), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'audio/mpeg',
    token,
    abortSignal: AbortSignal.timeout(120_000),
  });
  // Blob propagation to the public origin can lag the PUT by a few seconds.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await clipExistsRemotely(hash)) return 'uploaded';
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`uploaded ${hash} but the public URL does not resolve`);
};

const collectFiles = (paths: string[]): string[] => {
  const files: string[] = [];
  for (const path of paths) {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const name of readdirSync(path)) {
        if (HASH_FILE_PATTERN.test(name)) files.push(join(path, name));
      }
    } else {
      files.push(path);
    }
  }
  return files;
};

const main = async (): Promise<void> => {
  loadPipelineEnv();
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      'usage: bun run src/pipeline/uploadClips.ts <file-or-dir ...>',
    );
    process.exit(2);
  }
  const token = requireEnv('BLOB_READ_WRITE_TOKEN');
  const files = collectFiles(args);
  if (files.length === 0) {
    console.error('no {hash}.mp3 files found in the given paths');
    process.exit(2);
  }
  let uploaded = 0;
  let skipped = 0;
  for (const file of files) {
    const name = basename(file);
    if (!HASH_FILE_PATTERN.test(name)) {
      console.error(`skipping ${name}: not a {32-hex-hash}.mp3 filename`);
      continue;
    }
    const hash = name.slice(0, 32);
    const outcome = await uploadClip(hash, readFileSync(file), token);
    if (outcome === 'uploaded') uploaded += 1;
    else skipped += 1;
    console.log(`${outcome === 'uploaded' ? '↑' : '='} ${name} (${outcome})`);
  }
  console.log(`done: ${uploaded} uploaded, ${skipped} already existed`);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
