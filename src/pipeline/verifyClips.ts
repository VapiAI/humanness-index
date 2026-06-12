/// <reference types="bun" />
/**
 * Verifies that every hosted audio clip a model needs actually resolves on
 * the arena audio origin (the part of "add a new model" that neither the
 * type system nor the hermetic test suite can check, since it requires
 * network access).
 *
 * For each requested model: HEADs all (source voice x 20 prompts) variant
 * clips plus the registry's pinned sample fallback clip.
 *
 *   bun run humanness:verify-clips <model-id ...>
 *   bun run humanness:verify-clips --all
 *
 * Derives everything from the registry, so it only covers REGISTERED
 * models; pre-registration verification is generateClips.ts --upload's
 * final HEAD pass over the same hashes.
 */
import {
  arenaClipUrl,
  arenaModelEntries,
  MODEL_ENTRIES,
  modelEntryById,
} from '../catalog';
import { audioUrlFor, variantsOfModel, PROMPTS } from '../server/catalog';
import { parseArgs } from './lib';

const entryByIdOrSlug = (key: string) =>
  modelEntryById(key) ?? MODEL_ENTRIES.find((model) => model.slug === key);

const CONCURRENCY = 8;

const headOk = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
};

const verifyModel = async (key: string): Promise<number> => {
  const entry = entryByIdOrSlug(key);
  if (!entry) {
    console.error(`✗ unknown model id or slug: ${key}`);
    return 1;
  }
  const modelId = entry.id;

  const urls = new Map<string, string>();
  for (const variant of variantsOfModel(modelId)) {
    for (const prompt of PROMPTS) {
      urls.set(`${variant.id} | ${prompt.id}`, audioUrlFor(variant.id, prompt.id));
    }
  }
  if (entry.sample?.fallbackClip) {
    urls.set('sample fallbackClip', arenaClipUrl(entry.sample.fallbackClip));
  }

  const checks = [...urls.entries()];
  const missing: string[] = [];
  for (let i = 0; i < checks.length; i += CONCURRENCY) {
    const batch = checks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ([label, url]) => ({ label, url, ok: await headOk(url) })),
    );
    for (const result of results) {
      if (!result.ok) missing.push(`${result.label} → ${result.url}`);
    }
  }

  if (missing.length === 0) {
    console.log(`✓ ${modelId}: all ${checks.length} clips resolve`);
    return 0;
  }
  console.error(`✗ ${modelId}: ${missing.length}/${checks.length} clips missing`);
  for (const line of missing) console.error(`  ${line}`);
  return 1;
};

const { positionals, flags } = parseArgs(process.argv.slice(2));
const modelIds = flags.has('all')
  ? arenaModelEntries().map((model) => model.id)
  : positionals;

if (modelIds.length === 0) {
  console.error(
    'usage: bun run humanness:verify-clips <model-id ...> | --all',
  );
  process.exit(2);
}

let failures = 0;
for (const modelId of modelIds) {
  failures += await verifyModel(modelId);
}
process.exit(failures === 0 ? 0 : 1);
