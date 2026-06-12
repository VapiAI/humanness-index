import { NextResponse } from 'next/server';

import { createBattle } from '@/server/arena';

export async function GET() {
  try {
    return NextResponse.json(await createBattle());
  } catch (error) {
    console.error('[humanness] battle failed:', error);
    return NextResponse.json({ error: 'Failed to create battle' }, { status: 500 });
  }
}
