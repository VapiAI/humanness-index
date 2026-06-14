import Link from 'next/link';

import type { ModelEntry, ProviderEntry } from '../../catalog';
import {
  bestStandingForProvider,
  INDEX_PATH,
  modelPath,
  modelQuickStats,
  providerPath,
  standingForModel,
} from '../../lib/detail';
import type { ArenaRow } from '../../lib/types';
import { ProviderLogo } from '../ProviderLogo';

type XlinkCardProps = {
  href: string;
  /** Provider display name whose mark fills the logo chip. */
  logoProvider: string;
  name: string;
  sub: string;
};

const XlinkCard = ({ href, logoProvider, name, sub }: XlinkCardProps) => (
  <Link className="detail-xlink-card" href={href}>
    <span className="detail-xlink-logo" aria-hidden="true">
      <ProviderLogo provider={logoProvider} />
    </span>
    <span className="detail-xlink-text">
      <span className="detail-xlink-name">{name}</span>
      <span className="detail-xlink-sub">{sub}</span>
    </span>
  </Link>
);

const IndexBackLink = () => (
  <p className="detail-xlink-back">
    <Link href={INDEX_PATH}>Back to the Humanness Index™</Link>
  </p>
);

type ModelCrossLinksProps = {
  provider: ProviderEntry;
  /** Listed sibling models from the same provider (page's model excluded). */
  siblings: ModelEntry[];
  rows: ArenaRow[];
};

/** Model page cross-links: the provider page, sibling models, and the hub. */
export const ModelCrossLinks = ({ provider, siblings, rows }: ModelCrossLinksProps) => (
  <section className="detail-section detail-xlinks" aria-label="Related pages">
    <h2>Keep exploring</h2>
    <div className="detail-xlink-grid">
      <XlinkCard
        href={providerPath(provider)}
        logoProvider={provider.name}
        name={provider.name}
        sub={`All ${provider.name} models on the Index`}
      />
      {siblings.map((sibling) => {
        const standing = standingForModel(rows, sibling.id);
        return (
          <XlinkCard
            key={sibling.id}
            href={modelPath(sibling)}
            logoProvider={provider.name}
            name={sibling.name}
            sub={
              standing
                ? `Rank #${standing.rank} \u00b7 Humanness ${standing.score}`
                : `Latency ${modelQuickStats(sibling, provider).latency}`
            }
          />
        );
      })}
    </div>
    <IndexBackLink />
  </section>
);

type ProviderCrossLinksProps = {
  /** Every other listed provider. */
  siblings: ProviderEntry[];
  rows: ArenaRow[];
};

/** Provider page cross-links: the sibling-providers strip plus the hub. */
export const ProviderCrossLinks = ({ siblings, rows }: ProviderCrossLinksProps) => (
  <section className="detail-section detail-xlinks" aria-label="Other providers">
    <h2>Other providers on the Index</h2>
    <div className="detail-xlink-grid">
      {siblings.map((sibling) => {
        const best = bestStandingForProvider(rows, sibling.name);
        return (
          <XlinkCard
            key={sibling.id}
            href={providerPath(sibling)}
            logoProvider={sibling.name}
            name={sibling.name}
            sub={
              best
                ? best.row.baseline
                  ? 'Baseline reference \u00b7 Humanness 100'
                  : `Best ranked model #${best.rank} \u00b7 ${best.row.model}`
                : 'Provider profile'
            }
          />
        );
      })}
    </div>
    <IndexBackLink />
  </section>
);
