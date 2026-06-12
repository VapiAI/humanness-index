/// <reference types="bun" />
/**
 * One-time migration: copy the event-sourced vote store (snapshot + every
 * event object under humanness/) verbatim from the OLD Blob store to the NEW
 * one, same pathnames. Verification is done separately by dumping standings
 * via src/server/store.ts load() against each token and diffing.
 *
 *   OLD_BLOB_TOKEN=... NEW_BLOB_TOKEN=... bun run scripts/migrate-store.ts
 */
import { list, put } from '@vercel/blob';

const OLD_TOKEN = process.env.OLD_BLOB_TOKEN!;
const NEW_TOKEN = process.env.NEW_BLOB_TOKEN!;
if (!OLD_TOKEN || !NEW_TOKEN) {
  console.error('OLD_BLOB_TOKEN and NEW_BLOB_TOKEN are required');
  process.exit(2);
}

const PREFIX = 'humanness/';

const listAll = async (token: string) => {
  const blobs = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, token, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
};

const main = async () => {
  const oldBlobs = await listAll(OLD_TOKEN);
  const existing = new Set((await listAll(NEW_TOKEN)).map((b) => b.pathname));
  console.log(
    `old store: ${oldBlobs.length} objects under ${PREFIX} (events: ${oldBlobs.filter((b) => b.pathname.startsWith('humanness/events/')).length}, snapshot: ${oldBlobs.some((b) => b.pathname === 'humanness/snapshot.json')})`,
  );

  let copied = 0;
  let skipped = 0;
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < oldBlobs.length) {
        const blob = oldBlobs[next];
        next += 1;
        if (existing.has(blob.pathname)) {
          skipped += 1;
          continue;
        }
        const copyOnce = async () => {
          const response = await fetch(`${blob.url}?t=${Date.now()}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(60_000),
          });
          if (!response.ok) {
            throw new Error(`GET ${blob.pathname} -> ${response.status}`);
          }
          const body = new Uint8Array(await response.arrayBuffer());
          await put(blob.pathname, Buffer.from(body), {
            access: 'public',
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: 'application/json',
            cacheControlMaxAge: blob.pathname.endsWith('snapshot.json')
              ? 0
              : 31536000,
            token: NEW_TOKEN,
            abortSignal: AbortSignal.timeout(60_000),
          });
        };
        try {
          await copyOnce();
          copied += 1;
        } catch (error) {
          console.error(`retrying ${blob.pathname}: ${(error as Error).message}`);
          try {
            await copyOnce();
            copied += 1;
          } catch (secondError) {
            console.error(
              `FAILED ${blob.pathname}: ${(secondError as Error).message}`,
            );
            failed += 1;
          }
        }
      }
    }),
  );
  console.log(`copy done: ${copied} copied, ${skipped} already existed, ${failed} failed`);

  const newBlobs = await listAll(NEW_TOKEN);
  const newPaths = new Set(newBlobs.map((b) => b.pathname));
  const missing = oldBlobs.filter((b) => !newPaths.has(b.pathname));
  console.log(
    `verify: new store has ${newBlobs.length} objects under ${PREFIX}; missing vs old: ${missing.length}`,
  );
  if (missing.length > 0 || failed > 0) {
    console.error(missing.map((b) => b.pathname).join('\n'));
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
