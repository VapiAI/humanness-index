import { ImageResponse } from 'next/og';

import { ARENA_ROWS } from '@/data/models';
import {
  listedModelEntryBySlug,
  providerOfModel,
  standingForModel,
  STAT_DASH,
} from '@/lib/detail';
import { sortByStanding } from '@/lib/scoring';
import { OG_SIZE, OgCard } from '@/server/ogCard';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt =
  'Model card from the Humanness Index™ by Vapi: blind-test Humanness score and rank.';

type ImageProps = { params: Promise<{ slug: string }> };

export default async function OpengraphImage({ params }: ImageProps) {
  const { slug } = await params;
  const entry = listedModelEntryBySlug(slug);
  if (!entry) return new Response('Not found', { status: 404 });
  const provider = providerOfModel(entry);

  // Deterministic standings for the card: the bundled production export
  // (the page HTML itself carries the hourly live snapshot).
  const rows = sortByStanding(ARENA_ROWS);
  const standing = standingForModel(rows, entry.id);

  const stats = [
    {
      label: 'Humanness',
      value: standing ? String(standing.score) : STAT_DASH,
    },
    { label: 'Rank', value: standing ? `#${standing.rank}` : STAT_DASH },
  ];
  if (entry.stats.latencyMs) {
    stats.push({ label: 'Latency', value: `${entry.stats.latencyMs.value} ms` });
  }

  return new ImageResponse(
    <OgCard provider={provider} kicker={provider.name} title={entry.name} stats={stats} />,
    size,
  );
}
