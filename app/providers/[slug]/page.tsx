import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { listedProviderEntries } from '@/catalog';
import {
  absoluteUrl,
  listedModelEntriesOfProvider,
  listedProviderEntryBySlug,
  providerPageDescription,
  providerPageTitle,
  providerPath,
} from '@/lib/detail';
import { ProviderDetailPage } from '@/ProviderDetailPage';
import { getStandingsSnapshot } from '@/server/standingsSnapshot';

// Every listed provider prerenders at build time. `dynamicParams = false` is
// the spec's intent but that segment config is incompatible with Next 16
// `cacheComponents` (build error); the registry guard below 404s unknown
// slugs and providers whose only models are unlisted.
export function generateStaticParams() {
  return listedProviderEntries().map((entry) => ({ slug: entry.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const entry = listedProviderEntryBySlug(slug);
  // Thrown here (before the body streams) so unknown/unlisted slugs get a
  // real 404 status, not a soft 404 inside the Suspense shell.
  if (!entry) notFound();
  const title = providerPageTitle(entry);
  const description = providerPageDescription(
    entry,
    listedModelEntriesOfProvider(entry.id).length,
  );
  const path = providerPath(entry);
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
async function HumannessProviderPageBody({ params }: PageProps) {
  const { slug } = await params;
  const entry = listedProviderEntryBySlug(slug);
  if (!entry) notFound();
  const snapshot = await getStandingsSnapshot();
  return <ProviderDetailPage entry={entry} snapshot={snapshot} />;
}

export default function HumannessProviderPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <HumannessProviderPageBody params={params} />
    </Suspense>
  );
}
