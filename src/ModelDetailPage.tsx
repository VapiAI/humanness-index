import './styles/tokens.css';
import './styles/humanness-index.css';
import './styles/detail.css';

import Link from 'next/link';

import type { ModelEntry } from './catalog';
import { CtaBand } from './components/CtaBand';
import { Breadcrumbs } from './components/detail/Breadcrumbs';
import { CopyBlocks } from './components/detail/CopyBlocks';
import { ModelCrossLinks } from './components/detail/CrossLinks';
import { FaqBlock } from './components/detail/FaqBlock';
import { JsonLd } from './components/detail/JsonLd';
import { ModelLiveStats } from './components/detail/LiveStandings';
import { SamplePlayer } from './components/detail/SamplePlayer';
import { StandingsExcerpt } from './components/detail/StandingsExcerpt';
import { StatsBlock } from './components/detail/StatsBlock';
import { ProviderLogo } from './components/ProviderLogo';
import { RankScale } from './components/RankScale';
import {
  breadcrumbsJsonLd,
  INDEX_PATH,
  listedModelEntriesOfProvider,
  modelJsonLd,
  modelStatsView,
  positioningLine,
  providerOfModel,
  providerPath,
  sortedRowsFrom,
  standingForModel,
  type BreadcrumbItem,
} from './lib/detail';
import type { ArenaRow } from './lib/types';
import {
  staticSampleUrlFor,
  type StandingsSnapshot,
} from './server/standingsSnapshot';

type ModelDetailPageProps = {
  entry: ModelEntry;
  snapshot: StandingsSnapshot;
};

/**
 * RSC body of /models/[slug]:
 * everything is server-rendered crawlable HTML except the sample player and
 * the live-standings refresher islands.
 */
export const ModelDetailPage = ({ entry, snapshot }: ModelDetailPageProps) => {
  const provider = providerOfModel(entry);
  const rows = sortedRowsFrom(snapshot.models);
  const standing = standingForModel(rows, entry.id);
  const siblings = listedModelEntriesOfProvider(provider.id).filter(
    (sibling) => sibling.id !== entry.id,
  );

  // Retired models leave the live leaderboard; keep the viz + sample alive
  // from registry identity (spec §3.4: never 404 or blank an earned URL).
  const vizRow: ArenaRow = standing?.row ?? {
    id: entry.id,
    provider: provider.name,
    model: entry.name,
    elo: 1200,
    uncertainty: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    likelyRank: entry.seedLikelyRank ?? '',
    voiceProfile: entry.voiceProfile,
  };

  const breadcrumbs: BreadcrumbItem[] = [
    { name: 'Humanness Index', path: INDEX_PATH },
    { name: provider.name, path: providerPath(provider) },
    { name: entry.name },
  ];

  return (
    <div className="hi-page hi-detail" data-nav-theme="light">
      <div className="app-rails" aria-hidden="true" />
      <JsonLd data={breadcrumbsJsonLd(breadcrumbs)} />
      <JsonLd data={modelJsonLd(entry, provider)} />

      <div className="detail-shell">
        <Breadcrumbs items={breadcrumbs} />
        <header className="detail-hero">
          <div className="detail-hero-copy">
            <p className="eyebrow">Humanness Index {'\u00b7'} TTS model</p>
            <div className="detail-hero-id">
              <span className="detail-hero-logo" aria-hidden="true">
                <ProviderLogo provider={provider.name} />
              </span>
              <div className="detail-hero-name">
                <h1>{entry.name}</h1>
                <p className="detail-hero-provider">
                  by <Link href={providerPath(provider)}>{provider.name}</Link>
                </p>
              </div>
              {entry.status === 'retired' && (
                <span className="detail-badge">Retired from the arena</span>
              )}
            </div>
            <p className="detail-hero-lead">{positioningLine(entry.copy)}</p>
            <ModelLiveStats
              modelId={entry.id}
              initialRows={rows}
              asOf={snapshot.asOf}
            />
            {standing && (
              <div className="detail-hero-scale">
                <RankScale model={standing.row} allModels={rows} />
              </div>
            )}
          </div>
          <div className="detail-hero-side">
            <SamplePlayer model={vizRow} fallbackUrl={staticSampleUrlFor(entry)} />
          </div>
        </header>
      </div>

      <StatsBlock
        heading={`${entry.name} key stats`}
        stats={modelStatsView(entry, provider)}
      />
      <CopyBlocks blocks={entry.copy} />
      <StandingsExcerpt rows={rows} modelId={entry.id} asOf={snapshot.asOf} />
      <FaqBlock faq={entry.faq ?? []} />
      <ModelCrossLinks provider={provider} siblings={siblings} rows={rows} />
      <CtaBand surface="model" />
    </div>
  );
};
