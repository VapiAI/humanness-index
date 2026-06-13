'use client';

import { useEffect, useRef } from 'react';

import { drawOrb, PALETTES, subscribeViz } from '../../lib/voiceViz';

// A fixed seed/speed so the brand orb always looks the same.
const FINGERPRINT = { p: 5, speed: 1 };

/**
 * The small brand orb in the nav wordmark: the same gradient orb the cards
 * use, gently breathing on the shared viz clock (no audio, just a soft
 * oscillating "level" so it always feels alive).
 */
export const NavOrb = ({ size = 28 }: { size?: number }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return subscribeViz(() => {
      frameRef.current += 1;
      const level = 0.3 + 0.3 * Math.sin(frameRef.current * 0.035);
      ctx.clearRect(0, 0, size, size);
      drawOrb(ctx, frameRef.current, size, PALETTES.mint, level, FINGERPRINT);
    });
  }, [size]);

  return (
    <canvas
      ref={ref}
      className="site-nav-orb"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
};
