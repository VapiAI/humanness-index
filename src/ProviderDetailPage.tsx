import './styles/tokens.css';
import './styles/humanness-index.css';
import './styles/detail.css';

import Link from 'next/link';

import { listedProviderEntries, type ProviderEntry } from './catalog';
import { CtaBand } from './components/CtaBand';
import { Breadcrumbs } from './components/detail/Breadcrumbs';
import { CopyBlocks } from './components/detail/CopyBlocks';
import { ProviderCrossLinks } from './components/detail/CrossLinks';
import { FaqBlock } from './components/detail/FaqBlock';
import { JsonLd } from './components/detail/JsonLd';
import { ProviderLiveStats } from './components/detail/LiveStandings';
import { StatsBlock } from './components/detail/StatsBlock';
import { ProviderLogo } from './components/ProviderLogo';
import {
  breadcrumbsJsonLd,
  faqJsonLd,
  INDEX_PATH,
  isBaselineProvider,
  listedModelEntriesOfProvider,
  modelPath,
  modelQuickStats,
  positioningLine,
  providerJsonLd,
  providerModelsItemListJsonLd,
  providerStatsView,
  sortedRowsFrom,
  standingForModel,
  STAT_DASH,
  type BreadcrumbItem,
} from './lib/detail';
import type { StandingsSnapshot } from './server/standingsSnapshot';

type ProviderDetailPageProps = {
  entry: ProviderEntry;
  snapshot: StandingsSnapshot;
};

/**
 * RSC body of /providers/[slug].
 * The models table is the page's core (and its ItemList JSON-LD); the only
 * client island is the live best-rank refresher in the hero.
 */
export const ProviderDetailPage = ({ entry, snapshot }: ProviderDetailPageProps) => {
  const rows = sortedRowsFrom(snapshot.models);
  const models = listedModelEntriesOfProvider(entry.id);
  const activeModels = models.filter((model) => model.status === 'active');
  const retiredModels = models.filter((model) => model.status === 'retired');
  const siblings = listedProviderEntries().filter(
    (sibling) => sibling.id !== entry.id,
  );

  const breadcrumbs: BreadcrumbItem[] = [
    { name: 'Humanness Index™', path: INDEX_PATH },
    { name: entry.name },
  ];

  const modelsTable = (tableModels: typeof models) => (
    <div className="ranking-table-wrap">
      <table className="ranking-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Model</th>
            <th className="rt-num">Humanness</th>
            <th className="rt-num">Latency</th>
            <th className="rt-num">Languages</th>
            <th className="rt-num">Price / 1M chars</th>
          </tr>
        </thead>
        <tbody>
          {tableModels.map((model) => {
            const standing = standingForModel(rows, model.id);
            const quick = modelQuickStats(model, entry);
            return (
              <tr key={model.id}>
                <td className="rt-rank">
                  {!standing
                    ? STAT_DASH
                    : standing.row.baseline
                      ? 'Baseline'
                      : `#${standing.rank}`}
                </td>
                <td className="rt-model">
                  <Link href={modelPath(model)}>{model.name}</Link>
                </td>
                <td className="rt-num">
                  {standing ? standing.score : STAT_DASH}
                </td>
                <td className="rt-num">{quick.latency}</td>
                <td className="rt-num">{quick.languages}</td>
                <td className="rt-num">{quick.price}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="hi-page hi-detail" data-nav-theme="light">
      <div className="app-rails" aria-hidden="true" />
      <JsonLd data={breadcrumbsJsonLd(breadcrumbs)} />
      <JsonLd data={providerJsonLd(entry)} />
      {models.some((model) => !model.baseline) && (
        <JsonLd data={providerModelsItemListJsonLd(entry, models)} />
      )}
      {entry.faq && entry.faq.length > 0 && (
        <JsonLd data={faqJsonLd(entry.faq)} />
      )}

      <div className="detail-shell">
        <Breadcrumbs items={breadcrumbs} />
        <header className="detail-hero">
          <div className="detail-hero-copy">
            <p className="eyebrow">
              {`Humanness Index\u2122 \u00b7 ${
                isBaselineProvider(entry) ? 'Baseline reference' : 'Provider'
              }`}
            </p>
            <div className="detail-hero-id">
              <span className="detail-hero-logo" aria-hidden="true">
                <ProviderLogo provider={entry.name} />
              </span>
              <div className="detail-hero-name">
                <h1>{entry.name}</h1>
                <p className="detail-hero-provider">
                  <a href={entry.websiteUrl} rel="noopener noreferrer" target="_blank">
                    {entry.websiteUrl.replace(/^https?:\/\//, '')}
                  </a>
                </p>
              </div>
            </div>
            <p className="detail-hero-lead">{positioningLine(entry.copy)}</p>
            <ProviderLiveStats
              providerName={entry.name}
              initialRows={rows}
              asOf={snapshot.asOf}
            />
          </div>
          <div className="detail-hero-side">
            <div className="detail-provider-card">
              <span className="detail-provider-medallion" aria-hidden="true">
                <ProviderLogo provider={entry.name} />
              </span>
              <dl className="detail-provider-quick">
                <div>
                  <dt>Models on the Index</dt>
                  <dd>{models.length}</dd>
                </div>
                <div>
                  <dt>Languages</dt>
                  <dd>{String(entry.stats.languages?.value ?? STAT_DASH)}</dd>
                </div>
                <div>
                  <dt>Price / 1M chars</dt>
                  <dd>{entry.stats.pricing?.value ?? STAT_DASH}</dd>
                </div>
              </dl>
              <a
                className="vapi-btn detail-provider-visit"
                href={entry.websiteUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Visit {entry.name}
              </a>
            </div>
          </div>
        </header>
      </div>

      <section
        className="detail-section detail-models"
        id="models"
        aria-label={`${entry.name} models on the Humanness Index™`}
      >
        <h2>{entry.name} models on the Humanness Index™</h2>
        {modelsTable(activeModels)}
        {retiredModels.length > 0 && (
          <div className="detail-models-retired">
            <h3>Previous models</h3>
            {modelsTable(retiredModels)}
          </div>
        )}
        <p className="detail-excerpt-foot">
          <Link href={`${INDEX_PATH}#rankings`}>
            Compare against the full Humanness Index™ rankings
          </Link>
        </p>
      </section>

      <CopyBlocks blocks={entry.copy} />
      <StatsBlock heading={`${entry.name} stats`} stats={providerStatsView(entry)} />
      <FaqBlock faq={entry.faq ?? []} />
      <ProviderCrossLinks siblings={siblings} rows={rows} />
      <CtaBand surface="provider" />
    </div>
  );
};
