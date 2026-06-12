import { NextResponse } from 'next/server';

import { getModels } from '@/server/arena';

export async function GET() {
  try {
    return NextResponse.json(await getModels());
  } catch (error) {
    console.error('[humanness] models failed:', error);
    return NextResponse.json({ error: 'Failed to load standings' }, { status: 500 });
  }
}
