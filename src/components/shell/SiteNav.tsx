import Link from 'next/link';

import { GitHubIcon } from '../icons';

export const GITHUB_URL = 'https://github.com/VapiAI/humanness-index';

/** The waveform brand mark, an inline copy of app/icon.svg. */
const NavMark = () => (
  <svg className="site-nav-mark" viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="14" fill="#0c1512" />
    <g stroke="#00cd8f" strokeWidth="3.4" strokeLinecap="round">
      <line x1="14" y1="27" x2="14" y2="37" />
      <line x1="23" y1="21" x2="23" y2="43" />
      <line x1="32" y1="14" x2="32" y2="50" />
      <line x1="41" y1="21" x2="41" y2="43" />
      <line x1="50" y1="27" x2="50" y2="37" />
    </g>
  </svg>
);

/** The standalone site's slim top bar: wordmark, GitHub, Vapi attribution. */
export const SiteNav = () => {
  return (
    <header className="site-nav">
      <a className="skip-nav" href="#main-content">
        Skip to content
      </a>
      <div className="site-nav-inner">
        <Link className="site-nav-wordmark" href="/">
          <NavMark />
          <span>
            The Humanness Index
            <span className="site-nav-tm">™</span>
          </span>
        </Link>
        <nav aria-label="Site" className="site-nav-links">
          <a
            className="site-nav-vapi"
            href="https://vapi.ai"
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="site-nav-vapi-prefix">Built by&nbsp;</span>Vapi
          </a>
          <a
            aria-label="GitHub repository"
            className="site-nav-github"
            href={GITHUB_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GitHubIcon />
            <span className="site-nav-github-label">GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
};
