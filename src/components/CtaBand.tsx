'use client';

import { trackCtaClicked } from '../lib/analytics';

const GITHUB_URL = 'https://github.com/VapiAI/humanness-index';
const RUN_YOUR_MODEL_MAILTO =
  'mailto:humannessindex@vapi.ai?subject=Run%20my%20model%20on%20the%20Humanness%20Index';

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
          The benchmark is open source. Suggest a model, read the methodology,
          or ask us to put your voice in the arena.
        </p>
        <div className="cta-actions">
          <a
            className="cta-btn cta-btn-primary"
            href={RUN_YOUR_MODEL_MAILTO}
            onClick={() => trackCtaClicked({ action: 'run-your-model', surface })}
          >
            Run your model
          </a>
          <a
            className="cta-btn cta-btn-ghost"
            href={GITHUB_URL}
            onClick={() => trackCtaClicked({ action: 'star-on-github', surface })}
            rel="noopener noreferrer"
            target="_blank"
          >
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
};
