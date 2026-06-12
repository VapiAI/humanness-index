'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { trackDetailLinkClicked } from '../lib/analytics';
import type { DetailLink } from '../lib/detail';

type DetailPageLinkProps = {
  link: DetailLink;
  kind: 'model' | 'provider';
  className?: string;
  children: ReactNode;
};

/**
 * Index-page link-out to a model/provider detail page. Shared by the
 * leaderboard cards, the rankings table, and the battle reveal so the policy
 * can't drift: stopPropagation keeps clicks off the host's select/play
 * surfaces, and every navigation is tracked.
 */
export const DetailPageLink = ({ link, kind, className, children }: DetailPageLinkProps) => (
  <Link
    className={className}
    href={link.path}
    onClick={(event) => {
      event.stopPropagation();
      trackDetailLinkClicked({ kind, slug: link.slug });
    }}
  >
    {children}
  </Link>
);
