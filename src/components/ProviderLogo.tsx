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
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
};
