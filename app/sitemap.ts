import type { MetadataRoute } from 'next';

import { listedModelEntries, listedProviderEntries } from '@/catalog';
import { absoluteUrl, modelPath, providerPath } from '@/lib/detail';

/**
 * The index page plus every listed detail page, registry-derived: unlisted
 * entries never get URLs, retired entries keep theirs (never 404 an earned
 * URL).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl('/'), changeFrequency: 'daily', priority: 1 },
    ...listedProviderEntries().map((entry) => ({
      url: absoluteUrl(providerPath(entry)),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...listedModelEntries().map((entry) => ({
      url: absoluteUrl(modelPath(entry)),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
