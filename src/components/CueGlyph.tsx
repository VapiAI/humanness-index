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
        // Sized to match the play triangle's footprint (same height/center) so
        // the cue doesn't change size when it toggles play <-> pause.
        <g fill={fill}>
          <rect x="8.6" y="6.2" width="3" height="11.6" rx="1.2" />
          <rect x="13.6" y="6.2" width="3" height="11.6" rx="1.2" />
        </g>
      ) : (
        // Single filled path with the corners rounded into the geometry. (A
        // stroke for rounding would double-cover the edge and, with this
        // translucent gloss, show a brighter triangle outline just inside it.)
        <path
          d="M10.3 6.4 L17.1 10.9 Q18.7 12 17.1 13.1 L10.3 17.6 Q8.6 18.7 8.6 16.7 L8.6 7.3 Q8.6 5.3 10.3 6.4 Z"
          fill={fill}
        />
      )}
    </svg>
  );
};
