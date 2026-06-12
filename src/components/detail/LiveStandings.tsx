'use client';

import { useEffect, useState } from 'react';

import { getModels } from '../../lib/api';
import {
  bestStandingForProvider,
  formatAsOfUtc,
  sortedRowsFrom,
  standingForModel,
} from '../../lib/detail';
import type { ArenaRow } from '../../lib/types';

type Standings = {
  rows: ArenaRow[];
  asOf: string;
};

/**
 * Live reconciliation of the server snapshot:
 * the RSC bakes an at-most-hour-old snapshot into crawlable HTML; on mount
 * this refetches /api/models and swaps the hero numbers in place,
 * the same seed-then-live merge the index page uses. The snapshot stays if
 * the fetch fails, and the "as of" label keeps a stale shell honest.
 */
const useLiveStandings = (initialRows: ArenaRow[], initialAsOf: string) => {
  const [standings, setStandings] = useState<Standings>({
    rows: initialRows,
    asOf: initialAsOf,
  });

  useEffect(() => {
    let cancelled = false;
    getModels()
      .then((response) => {
        if (cancelled) return;
        setStandings({
          rows: sortedRowsFrom(response.models),
          asOf: new Date().toISOString(),
        });
      })
      .catch(() => {
        // Keep the server snapshot.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return standings;
};

type ModelLiveStatsProps = {
  modelId: string;
  initialRows: ArenaRow[];
  asOf: string;
};

/** Model hero stat strip: live rank, Humanness, likely range, vote count. */
export const ModelLiveStats = ({ modelId, initialRows, asOf }: ModelLiveStatsProps) => {
  const standings = useLiveStandings(initialRows, asOf);
  const standing = standingForModel(standings.rows, modelId);
  if (!standing) return null;

  return (
    <div className="detail-hero-standings">
      <dl className="detail-hero-stats">
        <div className="detail-hero-stat">
          <dt>Rank</dt>
          <dd>#{standing.rank}</dd>
        </div>
        <div className="detail-hero-stat">
          <dt>Humanness</dt>
          <dd>{standing.score}</dd>
        </div>
        <div className="detail-hero-stat">
          <dt>Likely rank</dt>
          <dd>{standing.row.likelyRank.replace('-', '\u2013')}</dd>
        </div>
        <div className="detail-hero-stat">
          <dt>Blind votes</dt>
          <dd>{standing.votes.toLocaleString('en-US')}</dd>
        </div>
      </dl>
      <p className="detail-asof">Standings as of {formatAsOfUtc(standings.asOf)}</p>
    </div>
  );
};

type ProviderLiveStatsProps = {
  providerName: string;
  initialRows: ArenaRow[];
  asOf: string;
};

/** Provider hero line: the provider's best-placed model, kept live. */
export const ProviderLiveStats = ({
  providerName,
  initialRows,
  asOf,
}: ProviderLiveStatsProps) => {
  const standings = useLiveStandings(initialRows, asOf);
  const best = bestStandingForProvider(standings.rows, providerName);
  if (!best) return null;

  return (
    <div className="detail-hero-standings">
      <dl className="detail-hero-stats">
        <div className="detail-hero-stat">
          <dt>Best ranked model</dt>
          <dd>
            #{best.rank}{' '}
            <span className="detail-hero-stat-model">{best.row.model}</span>
          </dd>
        </div>
        <div className="detail-hero-stat">
          <dt>Humanness</dt>
          <dd>{best.score}</dd>
        </div>
      </dl>
      <p className="detail-asof">Standings as of {formatAsOfUtc(standings.asOf)}</p>
    </div>
  );
};
