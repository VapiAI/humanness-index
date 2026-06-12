import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { listedModelEntries } from '@/catalog';
import {
  absoluteUrl,
  listedModelEntryBySlug,
  modelPageDescription,
  modelPageTitle,
  modelPath,
  providerOfModel,
} from '@/lib/detail';
import { ModelDetailPage } from '@/ModelDetailPage';
import { getStandingsSnapshot } from '@/server/standingsSnapshot';

// Every listed slug prerenders at build time. `dynamicParams = false` is the
// spec's intent but that segment config is incompatible with Next 16
// `cacheComponents` (build error); the registry guard below 404s every
// unknown or unlisted slug instead.
export function generateStaticParams() {
  return listedModelEntries().map((entry) => ({ slug: entry.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const entry = listedModelEntryBySlug(slug);
  // Thrown here (before the body streams) so unknown/unlisted slugs get a
  // real 404 status, not a soft 404 inside the Suspense shell.
  if (!entry) notFound();
  const provider = providerOfModel(entry);
  const title = modelPageTitle(entry, provider);
  const description = modelPageDescription(entry, provider);
  const path = modelPath(entry);
  return {
    title,
    description,
    alternates: { canonical: path },
    // og:image / twitter:image come from the colocated opengraph-image.tsx.
    openGraph: {
      title,
      description,
      url: absoluteUrl(path),
      siteName: 'The Humanness Index™',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

// `await params` is uncached dynamic data under `cacheComponents`, so the
// page body that awaits it lives inside a `<Suspense>` boundary (same
// pattern as blog/[slug]); the standings fetch is cached separately in
// `getStandingsSnapshot` ('use cache' + hourly cacheLife).
async function HumannessModelPageBody({ params }: PageProps) {
  const { slug } = await params;
  const entry = listedModelEntryBySlug(slug);
  if (!entry) notFound();
  const snapshot = await getStandingsSnapshot();
  return <ModelDetailPage entry={entry} snapshot={snapshot} />;
}

export default function HumannessModelPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <HumannessModelPageBody params={params} />
    </Suspense>
  );
}
