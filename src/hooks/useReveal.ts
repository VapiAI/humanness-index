'use client';

import { useEffect, useRef, useState } from 'react';

type RevealOptions = {
  /** IntersectionObserver rootMargin; default fires a touch before fully in. */
  rootMargin?: string;
  threshold?: number;
  /**
   * Gate the entrance: while false the reveal stays un-armed (`inView` never
   * flips), so a caller can hold an animation until its data is ready — e.g.
   * the standings reveals wait for the live `/api/models` reconcile so the
   * count-up/rows animate to the live values instead of the cached snapshot and
   * then visibly jumping. Defaults to armed.
   */
  enabled?: boolean;
};

/**
 * Fires once when the referenced element first scrolls into view, returning a
 * ref + an `inView` flag. Used by the <Reveal>/<RevealGroup> wrappers and the
 * chart's dot entrance. Honors prefers-reduced-motion (reveals instantly) and
 * degrades gracefully where IntersectionObserver is unavailable. Pass
 * `enabled: false` to hold the entrance until the caller is ready.
 */
export const useReveal = <T extends HTMLElement = HTMLElement>(
  options?: RevealOptions,
) => {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    const el = ref.current;
    if (!el || inView || !enabled) return undefined;

    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      {
        rootMargin: options?.rootMargin ?? '0px 0px -15% 0px',
        threshold: options?.threshold ?? 0.12,
      },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, options?.rootMargin, options?.threshold, enabled]);

  return { ref, inView };
};
