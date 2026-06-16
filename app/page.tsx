import type { Metadata } from 'next';

import { JsonLd } from '@/components/detail/JsonLd';
import { HumannessIndexPage } from '@/HumannessIndexPage';
import {
  absoluteUrl,
  datasetJsonLd,
  INDEX_PATH,
  indexModelsItemListJsonLd,
} from '@/lib/detail';
import { getStandingsSnapshot } from '@/server/standingsSnapshot';

const TITLE = 'Humanness Index™: Which TTS Voice Is Most Human? | Vapi';
const DESCRIPTION =
  'The benchmark for how human voice AI sounds. Hear leading text-to-speech models blind against a real human and pick the most human-sounding voice for your agent.';

const OG_IMAGE = {
  url: '/og/og-v4.jpg',
  width: 1200,
  height: 630,
  alt: 'The Humanness Index™. Which voice model sounds the most human?',
};

export const metadata: Metadata = {
  // Absolute so the layout's "%s | Vapi" template does not double the suffix.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: INDEX_PATH },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: absoluteUrl(INDEX_PATH),
    siteName: 'The Humanness Index™',
    type: 'website',
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@Vapi_AI',
    creator: '@Vapi_AI',
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

export default async function HumannessIndex() {
  // First-paint standings from the same hourly snapshot the detail pages use
  // (and the same `getModels` source as /api/models), so the client hydrates
  // from the live model set/order instead of the bundled static export and the
  // table doesn't reshuffle when the on-mount fetch lands.
  const { models, totalUniqueVotes } = await getStandingsSnapshot();
  return (
    <>
      {/* The hub-to-detail ItemList (registry seed order) rides the server
          shell; the page body itself stays client-rendered, just seeded with
          the server snapshot for first paint. */}
      <JsonLd data={indexModelsItemListJsonLd()} />
      <JsonLd data={datasetJsonLd()} />
      <HumannessIndexPage initialStandings={{ models, totalUniqueVotes }} />
    </>
  );
}
