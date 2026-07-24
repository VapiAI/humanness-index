import { NextRequest, NextResponse } from 'next/server';

import { ARENA_AUDIO_ORIGIN } from '../../../src/catalog/audio';

/**
 * Same-origin audio relay over the Blob store.
 *
 * Added 2026-07-23 when Vercel's automatic mitigation started denying all
 * public reads of the audio store origin (`x-vercel-mitigated: deny`), which
 * silenced every Listen/battle clip in browsers. Function egress can still
 * read the store, so this route streams `audio/{hash}.mp3` through the site's
 * own domain; pointing HUMANNESS_AUDIO_ORIGIN at the site switches every
 * served clip URL onto it (see server/catalog.ts). Clips are content-hash
 * addressed and immutable, so responses cache hard at the CDN and the
 * function only runs on cold paths. Harmless to keep once the mitigation
 * lifts; unset HUMANNESS_AUDIO_ORIGIN to serve straight from the store again.
 */

const CLIP_FILE_PATTERN = /^[0-9a-f]{32}\.mp3$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (!CLIP_FILE_PATTERN.test(file)) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Forward Range so seeking keeps working; send the store token as
  // belt-and-braces in case unauthenticated egress is ever denied too.
  const headers: Record<string, string> = {};
  const range = request.headers.get('range');
  if (range) headers.range = range;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  const upstream = await fetch(`${ARENA_AUDIO_ORIGIN}/audio/${file}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!upstream.ok && upstream.status !== 206) {
    return new NextResponse('Upstream unavailable', { status: 502 });
  }

  const responseHeaders = new Headers({
    'content-type': 'audio/mpeg',
    // Content-hash addresses are immutable: cache forever, at the CDN too.
    'cache-control': 'public, max-age=31536000, s-maxage=31536000, immutable',
    'access-control-allow-origin': '*',
    'accept-ranges': 'bytes',
  });
  for (const name of ['content-length', 'content-range', 'etag']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
