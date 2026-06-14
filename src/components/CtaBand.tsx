'use client';

import { EnvelopeSimple } from '@phosphor-icons/react';

import { trackCtaClicked } from '../lib/analytics';
import { GitHubIcon } from './icons';
import { GITHUB_URL } from './shell/SiteNav';

const ADD_YOUR_MODEL_MAILTO =
  'mailto:humannessindex@vapi.ai?subject=Add%20my%20model%20to%20the%20Humanness%20Index';

type CtaBandProps = {
  /** Which page hosts the band (analytics attribution). */
  surface?: 'index' | 'model' | 'provider';
};

/** The dark CTA band above the site footer (texture set in CSS). */
export const CtaBand = ({ surface = 'index' }: CtaBandProps) => {
  return (
    <section aria-label="Get involved" className="cta-band" data-nav-theme="dark">
      <div className="band-rails" aria-hidden="true" />
      <div className="cta-inner">
        <h2 className="cta-title">How human does your model really sound?</h2>
        <p className="cta-sub">
          We built this to push voice AI toward sounding human. Add your model,
          read the methodology, or get your voice in the arena.
        </p>
        <div className="cta-actions">
          {/* A mailto, not a form — the envelope sets that expectation. */}
          <a
            className="cta-btn cta-btn-primary"
            href={ADD_YOUR_MODEL_MAILTO}
            onClick={() => trackCtaClicked({ action: 'add-your-model', surface })}
          >
            <EnvelopeSimple size={17} weight="bold" aria-hidden="true" />
            Add your model
          </a>
          <a
            className="cta-btn cta-btn-ghost"
            href={GITHUB_URL}
            onClick={() => trackCtaClicked({ action: 'star-on-github', surface })}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GitHubIcon />
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
};
