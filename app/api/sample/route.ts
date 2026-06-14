import { NextResponse } from 'next/server';

import { getSample, VoteError } from '@/server/arena';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const modelId = params.get('model') ?? '';
  // Opaque active-battle token: the server decodes it and, if this model is one
  // of the battle's two, samples a different voice so the clip can't unmask a
  // blind card. The client never learns the matchup.
  const battleToken = params.get('battleToken') ?? undefined;
  try {
    return NextResponse.json(await getSample(modelId, { battleToken }));
  } catch (error) {
    if (error instanceof VoteError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[humanness] sample failed:', error);
    return NextResponse.json({ error: 'Failed to pick a sample' }, { status: 500 });
  }
}
