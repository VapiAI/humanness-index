import { connection, NextResponse } from 'next/server';

import { getTotalUniqueVotes } from '@/server/arena';
import { getStandingsSnapshot } from '@/server/standingsSnapshot';

// The Bradley–Terry standings are an all-history fit over the vote log; serving
// the hourly-cached snapshot (the same one the pages render from) keeps the
// rankings fast and identical to first paint, instead of refitting per call.
// The unique-vote COUNT, though, is read live: the cached fit only updates the
// total every N votes (then sits behind an hourly cache), so serving it made
// the counter snap back to a stale round number on refresh while a fresh vote
// reported the true (much higher) total. Pairing cached rankings with the live
// count keeps the displayed number honest and consistent with POST /api/vote.
export async function GET() {
  // Opt out of static prerendering so the live count below runs per request:
  // without this, cacheComponents prerenders the route (the in-memory store
  // does no build-time I/O) and freezes the count to the hourly ISR window —
  // reviving the very staleness this endpoint is meant to avoid. The heavy BT
  // fit stays cached via getStandingsSnapshot's `'use cache'`.
  await connection();
  try {
    const [{ models }, totalUniqueVotes] = await Promise.all([
      getStandingsSnapshot(),
      getTotalUniqueVotes(),
    ]);
    return NextResponse.json({ models, totalUniqueVotes });
  } catch (error) {
    console.error('[humanness] models failed:', error);
    return NextResponse.json({ error: 'Failed to load standings' }, { status: 500 });
  }
}
