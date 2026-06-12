import { ImageResponse } from 'next/og';

import { ARENA_ROWS } from '@/data/models';
import {
  bestStandingForProvider,
  listedModelEntriesOfProvider,
  listedProviderEntryBySlug,
} from '@/lib/detail';
import { sortByStanding } from '@/lib/scoring';
import { OG_SIZE, OgCard } from '@/server/ogCard';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt =
  'Provider card from the Humanness Index by Vapi: text to speech models ranked by blind listener votes.';

type ImageProps = { params: Promise<{ slug: string }> };

export default async function OpengraphImage({ params }: ImageProps) {
  const { slug } = await params;
  const entry = listedProviderEntryBySlug(slug);
  if (!entry) return new Response('Not found', { status: 404 });

  const models = listedModelEntriesOfProvider(entry.id);
  const rows = sortByStanding(ARENA_ROWS);
  const best = bestStandingForProvider(rows, entry.name);

  const stats = [
    {
      label: models.length === 1 ? 'Model' : 'Models',
      value: `${models.length} on the Index`,
    },
  ];
  if (best) {
    stats.push({ label: 'Best rank', value: `#${best.rank} ${best.row.model}` });
  }

  return new ImageResponse(
    <OgCard provider={entry} kicker="Text to speech provider" title={entry.name} stats={stats} />,
    size,
  );
}
