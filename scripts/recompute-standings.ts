/// <reference types="bun" />
/**
 * Recompute the Bradley–Terry standings over the full production vote log and
 * persist them to humanness/standings.json (the cache the new read paths serve
 * from: pages, /api/models, pairing, and crowd-judgment).
 *
 * Run it BEFORE shipping the cache-backed code so the blob is warm from the
 * first request — pairing + crowd-judgment never start cold, and the build
 * never has to refit the whole log. The blob is brand new, so the currently
 * deployed (pre-cache) code ignores it: no races, safe to run anytime. It is
 * idempotent — re-running just refreshes the fit. Same code the background
 * `after` refit runs, so this doubles as the operational "force refresh".
 *
 *   BLOB_READ_WRITE_TOKEN=... bun run scripts/recompute-standings.ts
 */
import { recomputeStandings } from '../src/server/arena';

const main = async () => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error(
      'BLOB_READ_WRITE_TOKEN is required (this writes humanness/standings.json).',
    );
    process.exit(1);
  }

  const start = Date.now();
  const standings = await recomputeStandings();
  const seconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log(
    `\nWrote humanness/standings.json in ${seconds}s · ${standings.totalUniqueVotes} unique votes · asOf ${standings.asOf}\n`,
  );
  console.log('  #   model                              rating  likely rank');
  let rank = 0;
  for (const row of standings.models) {
    const isBaseline = row.id === 'human';
    if (!isBaseline) rank += 1;
    const label = isBaseline ? '  —' : `#${rank}`.padStart(3);
    console.log(
      `  ${label}  ${`${row.provider} ${row.model}`.padEnd(32)}  ${Math.round(
        row.elo,
      )
        .toString()
        .padStart(6)}  ${isBaseline ? 'Baseline' : row.rankRange}`,
    );
  }
  console.log('');
};

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
