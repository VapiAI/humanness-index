import type { MetadataRoute } from 'next';

/**
 * Web app manifest for the Humanness Index. Distinct from Vapi's own app
 * manifest: this names the Index itself. Icons reuse the Vapi favicon set
 * (app/icon.svg, app/apple-icon.png, app/favicon.ico); theme_color matches the
 * viewport themeColor in app/layout.tsx.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Humanness Index',
    short_name: 'Humanness Index',
    description: 'The open benchmark for how human voice AI sounds.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fbfdfc',
    theme_color: '#fbfdfc',
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/apple-icon.png', type: 'image/png', sizes: '180x180' },
      { src: '/favicon.ico', type: 'image/x-icon', sizes: '48x48' },
    ],
  };
}
