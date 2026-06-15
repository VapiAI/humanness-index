import type { MetadataRoute } from 'next';

import { listedModelEntries, listedProviderEntries } from '@/catalog';
import { absoluteUrl, modelPath, providerPath } from '@/lib/detail';

/**
 * The index page plus every listed detail page, registry-derived: unlisted
 * entries never get URLs, retired entries keep theirs (never 404 an earned
 * URL).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // Build/deploy time: every page reflects the live standings snapshot baked in
  // at build, so the deploy stamp is the most honest lastmod for all of them.
  const lastModified = new Date();
  return [
    { url: absoluteUrl('/'), lastModified, changeFrequency: 'daily', priority: 1 },
    ...listedProviderEntries().map((entry) => ({
      url: absoluteUrl(providerPath(entry)),
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...listedModelEntries().map((entry) => ({
      url: absoluteUrl(modelPath(entry)),
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
