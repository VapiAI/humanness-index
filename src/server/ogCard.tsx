/**
 * Shared layout for the detail pages' generated OG cards (next/og
 * ImageResponse, 1200x630): the index page's dark CTA-band aesthetic as a
 * solid-color approximation, provider mark in a white medallion, and a mint
 * stat row. Marks are local files under public/marks, read
 * with node:fs and inlined as data URIs (no remote fetch; Satori renders
 * both SVG and PNG data URIs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProviderEntry } from '../catalog';
import { brandLogoText } from '../data/providers';

export const OG_SIZE = { width: 1200, height: 630 };

const MARKS_DIR = join(process.cwd(), 'public/marks');

const markDataUri = (mark: string): string | null => {
  try {
    const file = readFileSync(join(MARKS_DIR, mark));
    const mime = mark.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    return `data:${mime};base64,${file.toString('base64')}`;
  } catch {
    return null;
  }
};

type OgStat = { label: string; value: string };

type OgCardProps = {
  provider: ProviderEntry;
  /** Big display line (model name or provider name). */
  title: string;
  /** Small line above the title (e.g. the provider name on model cards). */
  kicker: string;
  stats: OgStat[];
};

export const OgCard = ({ provider, title, kicker, stats }: OgCardProps) => {
  const mark = markDataUri(provider.mark);
  const monogram = brandLogoText(provider.name);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '56px 72px',
        backgroundColor: '#0a1f14',
        backgroundImage:
          'radial-gradient(90% 130% at 50% 0%, rgba(0, 205, 143, 0.16), rgba(10, 31, 20, 0))',
        color: '#ffffff',
        position: 'relative',
      }}
    >
      {/* Content-frame rails, echoing the page's vertical rules. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 48,
          width: 1,
          backgroundColor: 'rgba(255, 255, 255, 0.18)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 48,
          width: 1,
          backgroundColor: 'rgba(255, 255, 255, 0.18)',
        }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            letterSpacing: 4,
            color: 'rgba(255, 255, 255, 0.72)',
          }}
        >
          THE HUMANNESS INDEX{'\u2122'}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            color: 'rgba(255, 255, 255, 0.55)',
          }}
        >
          vapi.ai
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 148,
            height: 148,
            borderRadius: 36,
            backgroundColor: '#ffffff',
            boxShadow: '0 0 0 6px rgba(0, 205, 143, 0.22)',
          }}
        >
          {mark ? (
            <img
              src={mark}
              alt=""
              width={92}
              height={92}
              style={{ objectFit: 'contain' }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                color: '#1a1a2e',
                fontSize: 52,
                fontWeight: 700,
              }}
            >
              {monogram}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 30,
              color: 'rgba(255, 255, 255, 0.66)',
            }}
          >
            {kicker}
          </div>
          <div
            style={{
              display: 'flex',
              maxWidth: 880,
              fontSize: title.length > 18 ? 64 : 84,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1.04,
            }}
          >
            {title}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {stats.map((stat) => (
          <div
            key={stat.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '16px 26px',
              borderRadius: 999,
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 21,
                letterSpacing: 2,
                color: 'rgba(255, 255, 255, 0.6)',
              }}
            >
              {stat.label.toUpperCase()}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 30,
                fontWeight: 700,
                color: '#00cd8f',
              }}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
