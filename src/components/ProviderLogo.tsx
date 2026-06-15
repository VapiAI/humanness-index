'use client';

import { useState } from 'react';

import { brandLogoText, PROVIDER_MARKS } from '../data/providers';

/** Bare provider logomark from /public/marks; falls back to a monogram. */
export const ProviderLogo = ({ provider }: { provider: string }) => {
  const [failed, setFailed] = useState(false);
  const mark = PROVIDER_MARKS[provider];
  if (!mark || failed) {
    return <span className="rcard-logo-text">{brandLogoText(provider)}</span>;
  }
  return (
    <img
      className="rcard-logo"
      src={`/marks/${mark}`}
      alt={provider}
      // Match the base .rcard-logo box so the browser reserves space (no CLS);
      // CSS still controls the rendered size and the natural ratio wins on load.
      width={40}
      height={26}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
};
