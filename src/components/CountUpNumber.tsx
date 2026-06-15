'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Shared card-meter timing. The bar fill (RankScale `--fill-delay`) and this
 * count-up both key off the grid's one-time reveal (`is-in`) and use these, so
 * the number lands exactly with the bar:
 *  - cards fade in FIRST; METER_FILL_BASE_MS is the beat before the bar/number
 *    start, so the fill follows the card rather than racing it;
 *  - METER_FILL_STAGGER_MS cascades each card on top of that base;
 *  - duration + easing mirror `--fill-dur` / `--reveal-ease` in
 *    humanness-index.css so the bar and number move as one.
 */
export const METER_FILL_BASE_MS = 250;
export const METER_FILL_STAGGER_MS = 140;
export const METER_FILL_DURATION_MS = 900;

/** Per-card delay shared by the bar fill and the number count-up. */
export const meterFillDelayMs = (rank: number) =>
  METER_FILL_BASE_MS + (rank - 1) * METER_FILL_STAGGER_MS;

/**
 * cubic-bezier(0.16, 1, 0.3, 1) — the same curve as `--reveal-ease`, solved per
 * frame so the counting number tracks the bar's eased progress, not a linear
 * ramp.
 */
const easeReveal = (() => {
  const x1 = 0.16;
  const y1 = 1;
  const x2 = 0.3;
  const y2 = 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-4) break;
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= err / slope;
    }
    return sampleY(t);
  };
})();

type CountUpNumberProps = {
  value: number;
  /** Shared reveal trigger (grid `is-in`); the count fires once when it flips. */
  inView: boolean;
  delayMs: number;
  durationMs?: number;
  className?: string;
};

/**
 * The Humanness score, counting 0 -> value in sync with the card's meter fill.
 *
 * The real value is always in the SSR HTML and exposed to assistive tech via an
 * `.sr-only` node, so no-JS visitors and crawlers always see the final number.
 * The visible digits are a JS-only, motion-gated enhancement: once the grid
 * reveals, they reset to 0 and ease up to the value (fires once). Reduced motion
 * shows the value instantly, and live data refreshes settle to the new value
 * rather than re-counting from 0.
 */
export const CountUpNumber = ({
  value,
  inView,
  delayMs,
  durationMs = METER_FILL_DURATION_MS,
  className,
}: CountUpNumberProps) => {
  const [display, setDisplay] = useState(value);
  const animatedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!inView || animatedRef.current) return undefined;
    animatedRef.current = true;

    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setDisplay(value);
      return undefined;
    }

    // Empty to match the bar, then hold through the delay and ease up so the
    // number and the fill finish together.
    setDisplay(0);
    const startAt = performance.now() + delayMs;
    const step = (now: number) => {
      if (now < startAt) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      const f = Math.min(1, (now - startAt) / durationMs);
      setDisplay(Math.round(value * easeReveal(f)));
      rafRef.current = f < 1 ? requestAnimationFrame(step) : null;
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [inView, value, delayMs, durationMs]);

  // After the one-time count-up, live score refreshes just settle to the new
  // value (the count never replays from 0).
  useEffect(() => {
    if (animatedRef.current && rafRef.current === null) setDisplay(value);
  }, [value]);

  return (
    <span className={className}>
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
};
