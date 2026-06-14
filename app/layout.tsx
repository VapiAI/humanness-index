import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Tomorrow } from 'next/font/google';
import Script from 'next/script';
import type { PropsWithChildren } from 'react';

import { SiteFooter } from '@/components/shell/SiteFooter';
import { SiteNav } from '@/components/shell/SiteNav';

import '@/styles/shell.css';

// The display font behind the module's `--font-display` token (tokens.css).
// The original host site used its licensed Avantt cut; the standalone site
// substitutes Instrument Sans, an open font with similar weight range.
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument-sans',
});

// Uppercase eyebrow labels behind `--font-eyebrow` (tokens.css). The brand
// uses Gridnik; Tomorrow is the open-font stand-in. Only the two weights the
// eyebrows render are loaded (font-synthesis is off).
const tomorrow = Tomorrow({
  subsets: ['latin'],
  weight: ['500', '700'],
  display: 'swap',
  variable: '--font-tomorrow',
});

export const viewport: Viewport = {
  themeColor: '#fbfdfc',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://humannessindex.vapi.ai'),
  title: 'The Humanness Index™',
  description:
    'The benchmark for how human voice AI sounds. Vote in blind voice-vs-voice tests and explore the rankings of leading text-to-speech models.',
  robots: {
    index: true,
    follow: true,
  },
};

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

const RootLayout = ({ children }: PropsWithChildren) => {
  return (
    <html className={`${instrumentSans.variable} ${tomorrow.variable}`} lang="en">
      <head>
        {/* Analytics is env-gated: without NEXT_PUBLIC_POSTHOG_KEY (forks,
            local dev) nothing loads and lib/analytics.ts no-ops. */}
        {POSTHOG_KEY && (
          <Script id="posthog-analytics" strategy="afterInteractive">
            {`
              !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
              posthog.init('${POSTHOG_KEY}',{api_host:'${POSTHOG_HOST}'})
            `}
          </Script>
        )}
      </head>
      <body>
        <SiteNav />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
};

export default RootLayout;
