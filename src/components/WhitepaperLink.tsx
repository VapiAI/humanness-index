'use client';

import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { WHITEPAPER_URL } from './shell/SiteNav';
import { useWhitepaperGate } from './WhitepaperGate';

type WhitepaperLinkProps = {
  children: ReactNode;
  className?: string;
  /** Optional analytics hook, fired on activation before the gate opens. */
  onActivate?: () => void;
} & Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href' | 'onClick' | 'children' | 'className'
>;

/**
 * A "Read the whitepaper" trigger. Renders the same anchor the site used
 * before (so existing button styles apply), but intercepts the click to open
 * the email gate. The href/target remain as a no-JS / modified-click fallback
 * straight to the PDF.
 */
export const WhitepaperLink = ({
  children,
  className,
  onActivate,
  ...rest
}: WhitepaperLinkProps) => {
  const { openWhitepaperGate } = useWhitepaperGate();
  return (
    <a
      className={className}
      href={WHITEPAPER_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        // Let modified clicks (open-in-new-tab) fall through to the PDF.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        onActivate?.();
        openWhitepaperGate();
      }}
      {...rest}
    >
      {children}
    </a>
  );
};
