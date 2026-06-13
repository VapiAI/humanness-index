import Link from 'next/link';

import { GitHubIcon } from '../icons';
import { NavOrb } from './NavOrb';

export const GITHUB_URL = 'https://github.com/VapiAI/humanness-index';
export const METHODOLOGY_URL = `${GITHUB_URL}/blob/main/docs/METHODOLOGY.md`;

/** The standalone site's slim top bar: wordmark, GitHub, Vapi attribution. */
export const SiteNav = () => {
  return (
    <header className="site-nav">
      <a className="skip-nav" href="#main-content">
        Skip to content
      </a>
      <div className="site-nav-inner">
        <Link className="site-nav-wordmark" href="/">
          <NavOrb />
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
