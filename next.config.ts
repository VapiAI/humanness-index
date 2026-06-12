import type { NextConfig } from 'next';

// Mirrors the configuration the module shipped under inside vapi.ai
// (reactCompiler + cacheComponents) so extraction does not change runtime
// behavior: the standings snapshot relies on `'use cache'` + cacheLife,
// which require `cacheComponents`.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  cacheComponents: true,
  // Pin the workspace root so stray lockfiles in parent directories never
  // change module resolution.
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        // Clickjacking protection, carried over from the original host site.
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
        ],
      },
      {
        source: '/:all*(svg|jpg|jpeg|png|gif|webp|ico|woff|woff2)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
