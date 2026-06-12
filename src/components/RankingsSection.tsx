'use client';

import { useEffect, type FocusEvent } from 'react';

import { CaretDown, CaretUp, Info, MagnifyingGlass } from '@phosphor-icons/react';

import { voiceStats } from '../data/providers';
import { modelDetailLinkForId, providerDetailLinkForName } from '../lib/detail';
import { humannessScore } from '../lib/scoring';
import type { ScoredModel, TableSort, TableSortKey } from '../lib/types';
import { DetailPageLink } from './DetailPageLink';
import { RankPauseIcon, RankPlayIcon } from './icons';
import { ProviderLogo } from './ProviderLogo';
import { RankingVisualizationPanel } from './RankingChart';

/** Hover/focus (i) bubble for table-header definitions. */
const InfoTip = ({ tip }: { tip: string }) => (
  <span className="rt-info" tabIndex={0} aria-label={tip}>
    <Info size={14} weight="bold" aria-hidden="true" />
    <span className="rt-info-tip" aria-hidden="true">
      {tip}
    </span>
  </span>
);

/** Clickable column header: first click sorts, second flips direction. */
const SortHeader = ({
  label,
  sortKey,
  sort,
  onSortChange,
}: {
  label: string;
  sortKey: TableSortKey;
  sort: TableSort;
  onSortChange: (key: TableSortKey) => void;
}) => {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      className={`rt-sort${active ? ' is-active' : ''}`}
      aria-label={`Sort by ${label}${active ? `, currently ${sort.dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
      onClick={() => onSortChange(sortKey)}
    >
      {label}
      {active && (
        <span className="rt-sort-arrow" aria-hidden="true">
          {sort.dir === 'asc' ? (
            <CaretUp size={11} weight="bold" />
          ) : (
            <CaretDown size={11} weight="bold" />
          )}
        </span>
      )}
    </button>
  );
};

const ariaSortFor = (
  sort: TableSort,
  key: TableSortKey,
): 'ascending' | 'descending' | undefined =>
  sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;

type RankingsSectionProps = {
  sortedModels: ScoredModel[];
  filteredRows: ScoredModel[];
  visibleRows: ScoredModel[];
  totalUniqueVotes: number;
  search: string;
  provider: string;
  providerOptions: string[];
  showAll: boolean;
  focusedModel: ScoredModel | null;
  focusedModelId: string | null;
  playingId: string | null;
  sort: TableSort;
  onSortChange: (key: TableSortKey) => void;
  onSearchChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onToggleShowAll: () => void;
  onSelectModel: (model: ScoredModel) => void;
  onClearFocus: () => void;
  onTogglePlay: (model: ScoredModel) => void;
};

/** "Humanness Deep Dive" — counts strip, filters, distribution chart, and the full table. */
export const RankingsSection = ({
  sortedModels,
  filteredRows,
  visibleRows,
  totalUniqueVotes,
  search,
  provider,
  providerOptions,
  showAll,
  focusedModel,
  focusedModelId,
  playingId,
  sort,
  onSortChange,
  onSearchChange,
  onProviderChange,
  onToggleShowAll,
  onSelectModel,
  onClearFocus,
  onTogglePlay,
}: RankingsSectionProps) => {
  // Selection is sticky only on the dots/rows themselves: pressing anywhere
  // else (empty chart space, the toolbar, the rest of the page) deselects and
  // stops the sample. Escape deselects too. Scoped to an active selection so
  // normal page interactions are untouched.
  useEffect(() => {
    if (!focusedModelId) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.chart-point, .ranking-table tbody tr')) return;
      onClearFocus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClearFocus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [focusedModelId, onClearFocus]);

  // Keyboard path: tabbing out of the section also clears the selection.
  const handleSectionBlur = (event: FocusEvent<HTMLElement>) => {
    if (!focusedModelId) return;
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) onClearFocus();
  };

  // Focus only highlights the chosen row/dot and dims the rest — it filters
  // the chart's bright set, never the table.
  const rankingRows = focusedModelId
    ? filteredRows.filter((model) => model.id === focusedModelId)
    : filteredRows;
  const tableHighlightId = focusedModelId ?? sortedModels[0]?.id;
  const providerCount = new Set(sortedModels.map((m) => m.provider)).size;
  const topScore = sortedModels.length ? humannessScore(sortedModels[0], sortedModels) : 0;

  return (
    <section className="long-tail-section" id="rankings" onBlur={handleSectionBlur}>
      <div className="rankings-header">
        <h2>Humanness Deep Dive</h2>
        <div className="rankings-stats">
          <span className="rankings-stat">{sortedModels.length} Models</span>
          <i className="rankings-divider" />
          <span className="rankings-stat">{providerCount} providers</span>
          <i className="rankings-divider" />
          <span className="rankings-stat">Top Humanness Score {topScore}</span>
          <i className="rankings-divider" />
          <span className="rankings-stat">
            <strong>{totalUniqueVotes.toLocaleString()}</strong> unique votes
          </span>
        </div>
      </div>
      <div className="rankings-toolbar">
        <div className="rankings-search">
          <MagnifyingGlass size={16} />
          <input
            value={search}
            aria-label="Search model rankings"
            placeholder="Search Provider or model"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <div className="rankings-select">
          <span className="rankings-select-label">Provider:</span>
          <select
            aria-label="Filter by provider"
            value={provider}
            onChange={(event) => onProviderChange(event.target.value)}
          >
            {providerOptions.map((providerName) => (
              <option key={providerName} value={providerName}>
                {providerName === 'All providers' ? 'All' : providerName}
              </option>
            ))}
          </select>
          <CaretDown size={16} weight="fill" />
        </div>
      </div>

      <RankingVisualizationPanel
        rows={rankingRows}
        allModels={sortedModels}
        focusedModel={focusedModel}
        onFocusModel={onSelectModel}
        onClearFocus={onClearFocus}
      />

      <div className="ranking-table-wrap">
        <table className="ranking-table">
          <thead>
            <tr>
              <th aria-sort={ariaSortFor(sort, 'rank')}>
                <SortHeader label="Rank" sortKey="rank" sort={sort} onSortChange={onSortChange} />
              </th>
              <th className="rt-rank">
                Likely Rank
                <InfoTip tip="Shown as a range because this model needs more votes to pin down its exact rank. It narrows as more people vote." />
              </th>
              <th aria-sort={ariaSortFor(sort, 'provider')}>
                <SortHeader label="Provider" sortKey="provider" sort={sort} onSortChange={onSortChange} />
              </th>
              <th>Model</th>
              <th className="rt-num" aria-sort={ariaSortFor(sort, 'humanness')}>
                <SortHeader label="Humanness" sortKey="humanness" sort={sort} onSortChange={onSortChange} />
                <InfoTip tip="Based on each model's Elo rating from blind votes, normalized so the top voice scores 100 and the bottom scores 0." />
              </th>
              <th className="rt-num" aria-sort={ariaSortFor(sort, 'latency')}>
                <SortHeader label="Latency" sortKey="latency" sort={sort} onSortChange={onSortChange} />
                <InfoTip tip="Median time to first audio across 50 sequential streaming API requests per model, measured June 2026. Models without a publicly accessible API show a dash." />
              </th>
              <th className="rt-num" aria-sort={ariaSortFor(sort, 'price')}>
                <SortHeader label="Price / 1M chars" sortKey="price" sort={sort} onSortChange={onSortChange} />
                <InfoTip tip="Published pay-as-you-go API pricing, normalized to US dollars per million characters. Open-source models show no price." />
              </th>
              <th className="rt-num" aria-sort={ariaSortFor(sort, 'votes')}>
                <SortHeader label="Positive Votes" sortKey="votes" sort={sort} onSortChange={onSortChange} />
              </th>
              <th className="rt-listen">Listen</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((model) => {
              const rank = sortedModels.findIndex((row) => row.id === model.id) + 1;
              const isDimmed = Boolean(focusedModelId) && model.id !== focusedModelId;
              const stats = voiceStats(model);
              // Rows select+play on click; the detail links stop propagation
              // so navigating never toggles selection. Unlisted/unknown rows
              // render as plain text.
              const modelLink = modelDetailLinkForId(model.id);
              const providerLink = providerDetailLinkForName(model.provider);
              const providerCell = (
                <>
                  <span className="rt-provider-chip" aria-hidden="true">
                    <ProviderLogo provider={model.provider} />
                  </span>
                  <span className="rt-provider-name">{model.provider}</span>
                </>
              );
              return (
                <tr
                  key={model.id}
                  className={`${model.id === tableHighlightId ? 'selected-row' : ''}${isDimmed ? ' is-dimmed' : ''}`}
                  onClick={() => onSelectModel(model)}
                >
                  <td className="rt-rank">#{rank}</td>
                  <td className="rt-rank">{model.likelyRank.replace('-', '–')}</td>
                  <td>
                    {providerLink ? (
                      <DetailPageLink
                        className="rt-provider rt-provider-link"
                        kind="provider"
                        link={providerLink}
                      >
                        {providerCell}
                      </DetailPageLink>
                    ) : (
                      <span className="rt-provider">{providerCell}</span>
                    )}
                  </td>
                  <td className="rt-model">
                    {modelLink ? (
                      <DetailPageLink className="rt-model-link" kind="model" link={modelLink}>
                        {model.model}
                      </DetailPageLink>
                    ) : (
                      model.model
                    )}
                  </td>
                  <td className="rt-num">{humannessScore(model, sortedModels)}</td>
                  <td className="rt-num">{stats.latency}</td>
                  <td className="rt-num">{stats.price}</td>
                  <td className="rt-num">{model.wins.toLocaleString()}</td>
                  <td className="rt-listen">
                    <button
                      className="rt-play"
                      type="button"
                      aria-label={
                        playingId === model.id
                          ? `Stop ${model.provider} ${model.model}`
                          : `Play ${model.provider} ${model.model}`
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onTogglePlay(model);
                      }}
                    >
                      {playingId === model.id ? <RankPauseIcon /> : <RankPlayIcon />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filteredRows.length > 10 && (
        <button className="ranking-showall" type="button" onClick={onToggleShowAll}>
          {showAll ? 'Show top 10' : `Show all ${filteredRows.length}`}
        </button>
      )}
      <p className="ranking-foot">
        The Index only includes models that support voice cloning: each battle
        plays the same cloned source voice through both models, so the
        comparison is head to head and fair. Don&apos;t see your model on this
        list? Contact us at{' '}
        <a href="mailto:humannessindex@vapi.ai">humannessindex@vapi.ai</a>.
      </p>
    </section>
  );
};
