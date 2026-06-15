'use client';

import { useEffect, useRef, useState } from 'react';

type RevealOptions = {
  /** IntersectionObserver rootMargin; default fires a touch before fully in. */
  rootMargin?: string;
  threshold?: number;
};

/**
 * Fires once when the referenced element first scrolls into view, returning a
 * ref + an `inView` flag. Used by the <Reveal>/<RevealGroup> wrappers and the
 * chart's dot entrance. Honors prefers-reduced-motion (reveals instantly) and
 * degrades gracefully where IntersectionObserver is unavailable.
 */
export const useReveal = <T extends HTMLElement = HTMLElement>(
  options?: RevealOptions,
) => {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return undefined;

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
  }, [inView, options?.rootMargin, options?.threshold]);

  return { ref, inView };
};
