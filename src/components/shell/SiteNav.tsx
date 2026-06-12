import Link from 'next/link';

export const GITHUB_URL = 'https://github.com/VapiAI/humanness-index';

/** The standalone site's slim top bar: wordmark, GitHub, Vapi attribution. */
export const SiteNav = () => {
  return (
    <header className="site-nav">
      <a className="skip-nav" href="#main-content">
        Skip to content
      </a>
      <div className="site-nav-inner">
        <Link className="site-nav-wordmark" href="/">
          The Humanness Index
        </Link>
        <nav aria-label="Site" className="site-nav-links">
          <a
            href={GITHUB_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            GitHub
          </a>
          <a
            className="site-nav-vapi"
            href="https://vapi.ai"
            rel="noopener noreferrer"
            target="_blank"
          >
            Built by Vapi
          </a>
        </nav>
      </div>
    </header>
  );
};
