import { NextResponse } from 'next/server';

import { getSample, VoteError } from '@/server/arena';

export async function GET(request: Request) {
  const modelId = new URL(request.url).searchParams.get('model') ?? '';
  try {
    return NextResponse.json(await getSample(modelId));
  } catch (error) {
    if (error instanceof VoteError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[humanness] sample failed:', error);
    return NextResponse.json({ error: 'Failed to pick a sample' }, { status: 500 });
  }
}
