/// <reference types="bun" />
/**
 * Switch the store's "which votes are not folded yet?" lookup from listing
 * every event blob ever written (a round trip per 1,000 votes, and climbing)
 * to listing one generation of markers (a couple of dozen blobs, forever).
 *
 * It refolds humanness/snapshot.json from the full vote log and stamps it with
 * `generation: 1`, which is the flag reads use to switch over. Marker blobs
 * are written by every vote as of the deploy that added them, so run this
 * AFTER that code is live — before it, markers exist for no votes and reads
 * would miss them. Deploying without running this is safe: a snapshot with no
 * generation keeps the old full-listing path.
 *
 * Idempotent, and doubles as the repair tool if snapshot counts ever drift
 * (the published standings come from the log, not this blob, so a rebuild
 * cannot lose a vote).
 *
 *   BLOB_READ_WRITE_TOKEN=... bun run scripts/migrate-pending-markers.ts
 */
import { arenaStore } from '../src/server/store';

const main = async () => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error(
      'BLOB_READ_WRITE_TOKEN is required (this rewrites humanness/snapshot.json).',
    );
    process.exit(1);
  }

  const store = arenaStore();
  const before = Date.now();
  const { totalVotes, generation } = await store.rebuildSnapshot();
  const rebuildSeconds = ((Date.now() - before) / 1000).toFixed(1);

  // Prove the switch: this read now goes through the markers. Blob overwrites
  // take a moment to propagate, so pause first or this reads the old snapshot.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const readStart = Date.now();
  const exact = await store.load();
  const readMs = Date.now() - readStart;

  console.log(
    `\nRefolded humanness/snapshot.json in ${rebuildSeconds}s · ` +
      `${totalVotes} unique votes · generation ${generation}`,
  );
  console.log(`Marker-backed load(): ${readMs} ms · ${exact.totalVotes} unique votes`);
  if (exact.totalVotes !== totalVotes) {
    console.log(
      `  (${exact.totalVotes - totalVotes} vote(s) difference — votes landing ` +
        `during or after the refold, replayed from their markers)`,
    );
  }
};

await main();
