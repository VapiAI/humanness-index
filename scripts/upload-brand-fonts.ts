/// <reference types="bun" />
/**
 * One-off: upload the licensed brand fonts from public/fonts/brand/ to the
 * project's Vercel Blob store under fonts/brand/<file> (stable paths, no random
 * suffix). Run with the store token loaded:
 *
 *   bun --env-file=src/pipeline/.env scripts/upload-brand-fonts.ts
 */
import { readdir, readFile } from 'node:fs/promises';

import { put } from '@vercel/blob';

const tokenFromEnvFile = async (): Promise<string | undefined> => {
  try {
    const text = await readFile('src/pipeline/.env', 'utf8');
    const line = text
      .split('\n')
      .find((l) => l.startsWith('BLOB_READ_WRITE_TOKEN='));
    return line?.slice('BLOB_READ_WRITE_TOKEN='.length).trim() || undefined;
  } catch {
    return undefined;
  }
};

const DIR = 'public/fonts/brand';
const CONTENT_TYPE: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
};

const main = async () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN ?? (await tokenFromEnvFile());
  if (!token) {
    console.error('BLOB_READ_WRITE_TOKEN required');
    process.exit(2);
  }
  const files = (await readdir(DIR))
    .filter((f) => f.endsWith('.woff2') || f.endsWith('.otf'))
    .sort();
  for (const file of files) {
    const ext = file.slice(file.lastIndexOf('.'));
    const bytes = await readFile(`${DIR}/${file}`);
    const result = await put(`fonts/brand/${file}`, bytes, {
      access: 'public',
      addRandomSuffix: false,
      contentType: CONTENT_TYPE[ext],
      token,
    });
    console.log(`${file} -> ${result.url}`);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
