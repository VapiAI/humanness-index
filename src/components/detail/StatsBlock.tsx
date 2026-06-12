import type { StatsView } from '../../lib/detail';

const EXTERNAL_URL = /^https?:\/\//;

const sourceLabel = (sourceUrl: string): string => {
  if (sourceUrl.startsWith('team-reported/')) {
    return 'Vapi team measurement';
  }
  if (!EXTERNAL_URL.test(sourceUrl)) {
    // Internal measurement artifacts (src/pipeline/results/*) have no
    // public URL; the footnote note carries the methodology.
    return 'Vapi streaming benchmark (50 trials per model)';
  }
  try {
    const url = new URL(sourceUrl);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return sourceUrl;
  }
};

type StatsBlockProps = {
  heading: string;
  stats: StatsView;
};

/**
 * Sourced-stat block: every claimed value carries a footnote marker into the
 * sources list at the block's foot (sourceUrl + asOf + method note). Values
 * without a source render as a dash with an inline note, never as guesses.
 * Each page hosts at most one block, so the footnote anchor ids stay unique.
 */
export const StatsBlock = ({ heading, stats }: StatsBlockProps) => (
  <section className="detail-section detail-stats" aria-label={heading}>
    <h2>{heading}</h2>
    <dl className="detail-stats-grid">
      {stats.rows.map((row) => (
        <div key={row.label} className="detail-stat">
          <dt>{row.label}</dt>
          <dd>
            <span className="detail-stat-value">{row.value}</span>
            {row.marker !== undefined && (
              <sup className="detail-stat-ref">
                <a
                  href={`#stat-src-${row.marker}`}
                  aria-label={`Source ${row.marker} for ${row.label}`}
                >
                  {row.marker}
                </a>
              </sup>
            )}
            {row.note && <span className="detail-stat-note">{row.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
    {stats.footnotes.length > 0 && (
      <ol className="detail-stat-sources" aria-label="Stat sources">
        {stats.footnotes.map((footnote) => (
          <li key={footnote.marker} id={`stat-src-${footnote.marker}`}>
            {EXTERNAL_URL.test(footnote.sourceUrl) ? (
              <a href={footnote.sourceUrl} rel="noopener noreferrer" target="_blank">
                {sourceLabel(footnote.sourceUrl)}
              </a>
            ) : (
              sourceLabel(footnote.sourceUrl)
            )}
            {` (checked ${footnote.asOf}${
              footnote.confidence && footnote.confidence !== 'high'
                ? `, confidence: ${footnote.confidence}`
                : ''
            })`}
            {footnote.note && ` ${footnote.note}`}
          </li>
        ))}
      </ol>
    )}
  </section>
);
