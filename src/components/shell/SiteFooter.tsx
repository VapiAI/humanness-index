import { GITHUB_URL, METHODOLOGY_URL } from './SiteNav';

/** Site footer: methodology, contact, attribution, licensing pointers. */
export const SiteFooter = () => {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <p className="site-footer-wordmark">The Humanness Index™</p>
          <p className="site-footer-tagline">
            The open benchmark for how human voice AI sounds, built by Vapi to
            push the industry toward voices that pass as human.
          </p>
        </div>
        <nav aria-label="Footer" className="site-footer-links">
          <a href={METHODOLOGY_URL} rel="noopener noreferrer" target="_blank">
            Methodology
          </a>
          <a href={GITHUB_URL} rel="noopener noreferrer" target="_blank">
            GitHub
          </a>
          <a href="mailto:humannessindex@vapi.ai">Contact</a>
          <a href="https://vapi.ai" rel="noopener noreferrer" target="_blank">
            vapi.ai
          </a>
        </nav>
        <p className="site-footer-legal">
          Code is Apache-2.0. Standings data is CC BY 4.0. Audio clips and
          source voices are licensed recordings, all rights reserved.
          Provider logomarks belong to their respective owners and are used
          nominatively. &ldquo;The Humanness Index™&rdquo; name and logo are
          Vapi trademarks; see TRADEMARKS.md.
        </p>
      </div>
    </footer>
  );
};
