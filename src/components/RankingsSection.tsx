'use client';

import { useEffect, type FocusEvent } from 'react';

import { CaretDown, CaretUp, Info, MagnifyingGlass } from '@phosphor-icons/react';

import { voiceStats } from '../data/providers';
import { modelDetailLinkForId, providerDetailLinkForName } from '../lib/detail';
import { competitorRank, humannessScore } from '../lib/scoring';
import type { ScoredModel, TableSort, TableSortKey } from '../lib/types';
import { DetailPageLink } from './DetailPageLink';
import { RankPauseIcon, RankPlayIcon } from './icons';
import { ProviderLogo } from './ProviderLogo';
import { RankingVisualizationPanel } from './RankingChart';
import { VotesCount } from './VotesCount';

/**
 * Nudge the bubble horizontally so it never clips: the table is a horizontal
 * scroll container on mobile, so a bubble centered on an edge icon would run
 * off-screen. Clamps within the scroller's visible box (else the viewport).
 */
const clampTip = (host: HTMLElement) => {
  const bubble = host.querySelector<HTMLElement>('.rt-info-tip');
  if (!bubble) return;
  bubble.style.setProperty('--tip-shift', '0px');
  const scroller = host.closest('.ranking-table-wrap');
  const bounds: { left: number; right: number } = scroller
    ? scroller.getBoundingClientRect()
    : { left: 0, right: window.innerWidth };
  const pad = 8;
  const rect = bubble.getBoundingClientRect();
  let shift = 0;
  if (rect.left < bounds.left + pad) shift = bounds.left + pad - rect.left;
  else if (rect.right > bounds.right - pad) shift = bounds.right - pad - rect.right;
  if (shift) bubble.style.setProperty('--tip-shift', `${shift}px`);
};

/** Hover/focus (i) bubble for table-header definitions. */
const InfoTip = ({ tip }: { tip: string }) => (
  <span
    className="rt-info"
    tabIndex={0}
    aria-label={tip}
    onMouseEnter={(event) => clampTip(event.currentTarget)}
    onFocus={(event) => clampTip(event.currentTarget)}
  >
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
  // stops the sample. Escape deselects, and Up/Down step the selection to the
  // previous/next row (which plays it). All scoped to an active selection so
  // normal page interactions and scrolling are untouched otherwise.
  useEffect(() => {
    if (!focusedModelId) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.chart-point, .ranking-table tbody tr')) return;
      onClearFocus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClearFocus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      // Don't steal arrows from the search box or provider dropdown.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, select, textarea, [contenteditable]')) return;
      if (!visibleRows.length) return;
      event.preventDefault();
      const currentIndex = visibleRows.findIndex((m) => m.id === focusedModelId);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // An off-table selection (a chart dot outside the shown rows) steps in
      // from the matching end; otherwise move one row, clamped at the ends.
      const nextIndex =
        currentIndex === -1
          ? step === 1
            ? 0
            : visibleRows.length - 1
          : Math.min(visibleRows.length - 1, Math.max(0, currentIndex + step));
      const nextModel = visibleRows[nextIndex];
      if (!nextModel || nextModel.id === focusedModelId) return;
      onSelectModel(nextModel);
      document
        .querySelector(`.ranking-table tbody tr[data-model-id="${nextModel.id}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [focusedModelId, onClearFocus, visibleRows, onSelectModel]);

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
  // The Human baseline is a reference, not a competitor: it stays out of the
  // counts, the "top score", and the show-all total.
  const rankedModels = sortedModels.filter((m) => !m.baseline);
  const rankedFilteredCount = filteredRows.filter((m) => !m.baseline).length;
  // No default row highlight: only an explicit selection tints a row, so the
  // baseline's highlight stands alone instead of pairing with an auto-lit #1.
  const tableHighlightId = focusedModelId;
  const providerCount = new Set(rankedModels.map((m) => m.provider)).size;
  const topScore = rankedModels.length
    ? humannessScore(rankedModels[0], sortedModels)
    : 0;
  const allWins = rankedModels.map((m) => m.wins);

  return (
    <section className="long-tail-section" id="rankings" onBlur={handleSectionBlur}>
      <div className="rankings-header">
        <h2>Humanness Deep Dive</h2>
        <div className="rankings-stats">
          <span className="rankings-stat">
            {rankedModels.length} Models
            <InfoTip tip="Every listed model offers voice cloning, so each battle can play the same cloned source voice through both sides. Models without cloning can't be compared head to head and are left out; new ones join as cloning access lands." />
          </span>
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
      <p className="rankings-intro">
        Humanness against measured latency, the best voices sit top-right.
      </p>
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

      <div className="chart-callout section-callout section-callout-light">
        <p className="chart-callout-text">
          <strong>Why latency matters.</strong>{' '}
          A voice that lags breaks the conversation, no matter how human it sounds.
        </p>
      </div>

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
              <th>
                Model
                <InfoTip tip="Only models that support voice cloning are listed: every battle plays the same cloned source voice through both sides, so the comparison is fair and head to head." />
              </th>
              <th className="rt-num" aria-sort={ariaSortFor(sort, 'humanness')}>
                <SortHeader label="Humanness" sortKey="humanness" sort={sort} onSortChange={onSortChange} />
                <InfoTip tip="Based on each model's Elo rating from blind votes, normalized so a real human scores 100 and the lowest-rated voice scores 0." />
              </th>
              <th className="rt-num" aria-sort={ariaSortFor(sort, 'elo')}>
                <SortHeader label="Elo" sortKey="elo" sort={sort} onSortChange={onSortChange} />
                <InfoTip tip="Elo is each voice's rating from blind head-to-head votes. It rises when listeners pick it as more human, weighted by how strong the other voice was." />
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
                <InfoTip tip="How many listeners picked this voice as more human in blind battles. Rank is set by Elo, which also weights how strong each opponent was, so more votes doesn't always mean a higher rank." />
              </th>
              <th className="rt-listen">Listen</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((model) => {
              const rank = competitorRank(model.id, sortedModels);
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
                  data-model-id={model.id}
                  className={`${model.id === tableHighlightId ? 'selected-row' : ''}${model.baseline ? ' baseline-row' : ''}${isDimmed ? ' is-dimmed' : ''}`}
                  onClick={() => onSelectModel(model)}
                >
                  <td className="rt-rank">
                    {model.baseline ? (
                      <span className="rt-baseline-tag">Baseline</span>
                    ) : (
                      `#${rank}`
                    )}
                  </td>
                  <td className="rt-rank">
                    {model.baseline ? '\u2014' : model.likelyRank.replace('-', '\u2013')}
                  </td>
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
                  <td className="rt-num rt-elo">{Math.round(model.elo)}</td>
                  <td className="rt-num">{stats.latency}</td>
                  <td className="rt-num">{stats.price}</td>
                  <td className="rt-num rt-votes">
                    <VotesCount wins={model.wins} allWins={allWins} size={13} />
                  </td>
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
      {rankedFilteredCount > 10 && (
        <button className="ranking-showall" type="button" onClick={onToggleShowAll}>
          {showAll ? 'Show top 10' : `Show all ${rankedFilteredCount}`}
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
