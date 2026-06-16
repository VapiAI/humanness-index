import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Tomorrow } from 'next/font/google';
import Script from 'next/script';
import type { PropsWithChildren } from 'react';

import { JsonLd } from '@/components/detail/JsonLd';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { SiteNav } from '@/components/shell/SiteNav';
import { WhitepaperGateProvider } from '@/components/WhitepaperGate';
import { organizationJsonLd, webSiteJsonLd } from '@/lib/detail';

import '@/styles/brand-fonts.css';
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
  // Child routes set a bare title (e.g. "xAI Grok TTS: Humanness & Latency");
  // the template appends the brand suffix so every document title ends alike.
  title: {
    default: 'The Humanness Index™ | Vapi',
    template: '%s | Vapi',
  },
  description:
    'The benchmark for how human voice AI sounds. Hear leading text-to-speech models blind against a real human and pick the most human-sounding voice for your agent.',
  robots: {
    index: true,
    follow: true,
  },
  // Site-wide default so the Vapi handle rides every route; pages that set
  // their own `twitter` (home, model + provider detail) repeat it since a
  // child's twitter object replaces this one rather than merging.
  twitter: {
    site: '@Vapi_AI',
    creator: '@Vapi_AI',
  },
};

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

const RootLayout = ({ children }: PropsWithChildren) => {
  return (
    <html
      className={`${instrumentSans.variable} ${tomorrow.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        {/* Gate the scroll-reveal hidden state on JS being active: this runs
            before paint and adds `reveal-ready` to <html>, so the offset/hidden
            state only applies with JS. With JS disabled (and for crawlers) the
            class is absent and ALL content stays visible in the DOM. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('reveal-ready')",
          }}
        />
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
        {/* Publisher + site identity, emitted once for the whole site. */}
        <JsonLd data={organizationJsonLd()} />
        <JsonLd data={webSiteJsonLd()} />
      </head>
      <body>
        <WhitepaperGateProvider>
          <SiteNav />
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
        </WhitepaperGateProvider>
      </body>
    </html>
  );
};

export default RootLayout;
