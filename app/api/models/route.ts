import { connection, NextResponse } from 'next/server';

import { getLiveModelCounts } from '@/server/arena';
import { getStandingsSnapshot } from '@/server/standingsSnapshot';

// The Bradley–Terry RATINGS are an all-history fit over the vote log; serving
// the hourly-cached snapshot (the same one the pages render from) keeps rank +
// Humanness fast and identical to first paint, instead of refitting per call.
// The vote TALLIES, though, are read live and overlaid on those cached rows:
// the unique-vote total plus each model's win/loss/tie counts come straight
// from the store (snapshot + pending events), so a fresh vote shows up
// immediately instead of waiting for the next refit + hourly cache turnover.
// Rank/rating still come from the settled fit, so the board doesn't reshuffle
// per vote — only the counts tick up, consistent with POST /api/vote.
export async function GET() {
  // Opt out of static prerendering so the live counts below run per request:
  // without this, cacheComponents prerenders the route (the in-memory store
  // does no build-time I/O) and freezes the counts to the hourly ISR window —
  // reviving the very staleness this endpoint is meant to avoid. The heavy BT
  // fit stays cached via getStandingsSnapshot's `'use cache'`.
  await connection();
  try {
    const [{ models }, { counts, totalUniqueVotes }] = await Promise.all([
      getStandingsSnapshot(),
      getLiveModelCounts(),
    ]);
    // Overlay live tallies onto the cached rows (ratings/rank/order untouched).
    const liveModels = models.map((row) => {
      const live = counts[row.id];
      return live
        ? { ...row, wins: live.wins, losses: live.losses, ties: live.ties, voteCount: live.voteCount }
        : row;
    });
    return NextResponse.json({ models: liveModels, totalUniqueVotes });
  } catch (error) {
    console.error('[humanness] models failed:', error);
    return NextResponse.json({ error: 'Failed to load standings' }, { status: 500 });
  }
}
