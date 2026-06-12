import Link from 'next/link';

import { voiceStats } from '../../data/providers';
import {
  formatAsOfUtc,
  INDEX_PATH,
  modelDetailLinkForId,
  standingsExcerptFor,
} from '../../lib/detail';
import { humannessScore } from '../../lib/scoring';
import type { ArenaRow } from '../../lib/types';
import { ProviderLogo } from '../ProviderLogo';

type StandingsExcerptProps = {
  /** Full field, sorted best-first (the server snapshot). */
  rows: ArenaRow[];
  /** The page's model: its row is highlighted in the excerpt. */
  modelId: string;
  asOf: string;
};

/**
 * "Position in the rankings": the model's row with two neighbors each side,
 * rendered as a small static table (reusing the index table's styles) that
 * links back to the full standings on the index page.
 */
export const StandingsExcerpt = ({ rows, modelId, asOf }: StandingsExcerptProps) => {
  const excerpt = standingsExcerptFor(rows, modelId);
  if (excerpt.length === 0) return null;

  return (
    <section className="detail-section detail-excerpt" aria-label="Position in the rankings">
      <div className="detail-excerpt-head">
        <h2>Position in the rankings</h2>
        <p className="detail-asof">Standings as of {formatAsOfUtc(asOf)}</p>
      </div>
      <div className="ranking-table-wrap">
        <table className="ranking-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Provider</th>
              <th>Model</th>
              <th className="rt-num">Humanness</th>
              <th className="rt-num">Latency</th>
            </tr>
          </thead>
          <tbody>
            {excerpt.map(({ row, rank }) => {
              const isSelf = row.id === modelId;
              // Neighbors link to their own pages; the page's model and
              // unlisted rows stay plain text.
              const link = isSelf ? null : modelDetailLinkForId(row.id);
              const stats = voiceStats(row);
              return (
                <tr key={row.id} className={isSelf ? 'selected-row' : ''}>
                  <td className="rt-rank">#{rank}</td>
                  <td>
                    <span className="rt-provider">
                      <span className="rt-provider-chip" aria-hidden="true">
                        <ProviderLogo provider={row.provider} />
                      </span>
                      {row.provider}
                    </span>
                  </td>
                  <td className="rt-model">
                    {link ? <Link href={link.path}>{row.model}</Link> : row.model}
                  </td>
                  <td className="rt-num">{humannessScore(row, rows)}</td>
                  <td className="rt-num">{stats.latency}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="detail-excerpt-foot">
        <Link href={`${INDEX_PATH}#rankings`}>
          See the full Humanness Index rankings
        </Link>
      </p>
    </section>
  );
};
