/// <reference types="bun" />
/**
 * One-time migration: copy every manifest clip from the OLD Blob origin to
 * the NEW store under identical pathnames (audio/{hash}.mp3).
 *
 * Manifest = active VARIANTS x PROMPTS (server catalog) + every registry
 * sample.fallbackClip (incl. the private overlay via catalog merge) + the
 * pinned FALLBACK_BATTLE_SPECS clips. Manifest-driven only: legacy clips in
 * the old store are deliberately not copied.
 *
 *   OLD_ORIGIN=... NEW_ORIGIN=... NEW_BLOB_TOKEN=... bun run scripts/migrate-clips.ts [--verify-only]
 */
import { put } from '@vercel/blob';

import { MODEL_ENTRIES } from '../src/catalog';
import { FALLBACK_BATTLE_SPECS } from '../src/data/battles';
import { clipHash, looksLikeMp3, sleep } from '../src/pipeline/lib';
import { PROMPTS, VARIANTS } from '../src/server/catalog';

const OLD_ORIGIN = process.env.OLD_ORIGIN!;
const NEW_ORIGIN = process.env.NEW_ORIGIN!;
const TOKEN = process.env.NEW_BLOB_TOKEN!;
if (!OLD_ORIGIN || !NEW_ORIGIN || !TOKEN) {
  console.error('OLD_ORIGIN, NEW_ORIGIN, NEW_BLOB_TOKEN are required');
  process.exit(2);
}
const VERIFY_ONLY = process.argv.includes('--verify-only');

const buildManifest = (): string[] => {
  const paths = new Set<string>();
  for (const variant of VARIANTS) {
    for (const prompt of PROMPTS) {
      paths.add(`/audio/${clipHash(variant.id, prompt.id)}.mp3`);
    }
  }
  let samples = 0;
  for (const model of MODEL_ENTRIES) {
    if (model.sample?.fallbackClip) {
      paths.add(model.sample.fallbackClip.path);
      samples += 1;
    }
  }
  for (const spec of FALLBACK_BATTLE_SPECS) {
    paths.add(spec.left.clip.path);
    paths.add(spec.right.clip.path);
  }
  console.log(
    `manifest: ${VARIANTS.length} variants x ${PROMPTS.length} prompts = ${VARIANTS.length * PROMPTS.length}; ` +
      `${samples} sample fallbacks; ${FALLBACK_BATTLE_SPECS.length * 2} battle pins; ` +
      `unique paths = ${paths.size}`,
  );
  return [...paths].sort();
};

const head = async (url: string): Promise<boolean> => {
  const response = await fetch(url, {
    method: 'HEAD',
    signal: AbortSignal.timeout(30_000),
  });
  return response.ok;
};

type CopyOutcome = 'copied' | 'already-exists' | 'failed';

const copyOne = async (path: string): Promise<CopyOutcome> => {
  if (await head(`${NEW_ORIGIN}${path}`)) return 'already-exists';
  const source = await fetch(`${OLD_ORIGIN}${path}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!source.ok) throw new Error(`GET old ${path} -> ${source.status}`);
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (!looksLikeMp3(bytes)) throw new Error(`${path}: source is not MP3`);
  const result = await put(path.slice(1), Buffer.from(bytes), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'audio/mpeg',
    token: TOKEN,
    abortSignal: AbortSignal.timeout(120_000),
  });
  if (!result.url.startsWith(NEW_ORIGIN)) {
    throw new Error(`unexpected destination origin: ${result.url}`);
  }
  return 'copied';
};

const withRetry = async (path: string): Promise<CopyOutcome> => {
  try {
    return await copyOne(path);
  } catch (error) {
    console.error(`retrying ${path}: ${(error as Error).message}`);
    await sleep(2000);
    try {
      return await copyOne(path);
    } catch (secondError) {
      console.error(`FAILED ${path}: ${(secondError as Error).message}`);
      return 'failed';
    }
  }
};

const pooled = async <T, R>(
  items: T[],
  width: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
};

const main = async () => {
  const manifest = buildManifest();

  if (!VERIFY_ONLY) {
    const outcomes = await pooled(manifest, 8, withRetry);
    const counts = { copied: 0, 'already-exists': 0, failed: 0 };
    for (const outcome of outcomes) counts[outcome] += 1;
    console.log(
      `copy done: ${counts.copied} copied, ${counts['already-exists']} already existed, ${counts.failed} failed`,
    );
    if (counts.failed > 0) process.exit(1);
    // Blob propagation to the public origin can lag PUTs by a few seconds.
    await sleep(5000);
  }

  const missing: string[] = [];
  await pooled(manifest, 16, async (path) => {
    let ok = await head(`${NEW_ORIGIN}${path}`);
    if (!ok) {
      await sleep(3000);
      ok = await head(`${NEW_ORIGIN}${path}`);
    }
    if (!ok) missing.push(path);
  });
  console.log(
    `verify: ${manifest.length - missing.length}/${manifest.length} present on ${NEW_ORIGIN}`,
  );
  if (missing.length > 0) {
    console.error(`missing:\n${missing.join('\n')}`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
