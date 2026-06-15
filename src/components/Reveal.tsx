'use client';

import {
  createElement,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';

import { useReveal } from '../hooks/useReveal';

type RevealBaseProps = {
  /** Rendered element (default div). The wrapper IS the element, so it never
   *  adds a stray node that could break a grid/flex parent. */
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  id?: string;
  role?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-nav-theme'?: string;
  /** Override the IntersectionObserver trigger point (e.g. reveal earlier). */
  rootMargin?: string;
  threshold?: number;
};

/** A single block that fades + rises into view once. `delay` staggers it. */
export const Reveal = ({
  as = 'div',
  className = '',
  delay,
  rootMargin,
  threshold,
  style,
  children,
  ...rest
}: RevealBaseProps & { delay?: number }) => {
  const { ref, inView } = useReveal<HTMLElement>({ rootMargin, threshold });
  return createElement(
    as,
    {
      ref,
      className: `reveal${inView ? ' is-in' : ''}${className ? ` ${className}` : ''}`,
      style: delay ? { ...style, transitionDelay: `${delay}ms` } : style,
      ...rest,
    },
    children,
  );
};

/**
 * A container whose direct children cascade in (eyebrow -> heading -> intro ->
 * cards). The element itself is the existing container, so grids/flex layouts
 * are preserved. `stagger` overrides the per-child delay step.
 */
export const RevealGroup = ({
  as = 'div',
  className = '',
  stagger,
  rootMargin,
  threshold,
  style,
  children,
  ...rest
}: RevealBaseProps & { stagger?: number }) => {
  const { ref, inView } = useReveal<HTMLElement>({ rootMargin, threshold });
  const mergedStyle = stagger
    ? ({ ...style, '--reveal-stagger': `${stagger}ms` } as CSSProperties)
    : style;
  return createElement(
    as,
    {
      ref,
      className: `reveal-group${inView ? ' is-in' : ''}${className ? ` ${className}` : ''}`,
      style: mergedStyle,
      ...rest,
    },
    children,
  );
};
