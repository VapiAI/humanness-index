'use client';

import { useId } from 'react';

/**
 * The play/pause glyph for the orb cue. Filled with a top-left → bottom-right
 * white gloss (opaque to translucent) so it reads as lit by the same light as
 * the orb's sheen and sits on the glossy surface rather than floating flat.
 */
export const CueGlyph = ({ paused = false }: { paused?: boolean }) => {
  const id = useId();
  const fill = `url(#${id})`;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0.15" y1="0.08" x2="0.82" y2="0.95">
          <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.62" />
        </linearGradient>
      </defs>
      {paused ? (
        <g fill={fill}>
          <rect x="7" y="5" width="3.6" height="14" rx="1.4" />
          <rect x="13.4" y="5" width="3.6" height="14" rx="1.4" />
        </g>
      ) : (
        <path
          d="M9 6 18 12 9 18 Z"
          fill={fill}
          stroke={fill}
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
};
