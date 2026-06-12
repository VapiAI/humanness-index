import type { Metadata } from 'next';

import { JsonLd } from '@/components/detail/JsonLd';
import { HumannessIndexPage } from '@/HumannessIndexPage';
import {
  absoluteUrl,
  INDEX_PATH,
  indexModelsItemListJsonLd,
} from '@/lib/detail';

const TITLE = 'The Humanness Index™ | Vapi';
const DESCRIPTION =
  'The benchmark for how human voice AI sounds. Vote in blind voice-vs-voice tests and explore the rankings of leading text-to-speech models.';

const OG_IMAGE = {
  url: '/og/og.jpg',
  width: 1536,
  height: 1024,
  alt: 'The Humanness Index™. How human does your voice AI really sound?',
};

export const metadata: Metadata = {
  title: TITLE,
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
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

export default function HumannessIndex() {
  return (
    <>
      {/* The hub-to-detail ItemList (registry seed order) rides the server
          shell — the page body itself is fully client-rendered. */}
      <JsonLd data={indexModelsItemListJsonLd()} />
      <HumannessIndexPage />
    </>
  );
}
