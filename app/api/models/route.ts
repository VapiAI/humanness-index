import { NextResponse } from 'next/server';

import { getStandingsSnapshot } from '@/server/standingsSnapshot';

// The Bradley–Terry standings are an all-history fit over the vote log; serving
// the hourly-cached snapshot (the same one the pages render from) keeps this
// fast and the numbers identical to first paint, instead of refitting per call.
export async function GET() {
  try {
    const { models, totalUniqueVotes } = await getStandingsSnapshot();
    return NextResponse.json({ models, totalUniqueVotes });
  } catch (error) {
    console.error('[humanness] models failed:', error);
    return NextResponse.json({ error: 'Failed to load standings' }, { status: 500 });
  }
}
