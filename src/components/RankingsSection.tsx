'use client';

import { useEffect, type FocusEvent } from 'react';

import { CaretDown, CaretUp, Info } from '@phosphor-icons/react';

import { voiceStats } from '../data/providers';
import { useReveal } from '../hooks/useReveal';
import { modelDetailLinkForId, providerDetailLinkForName } from '../lib/detail';
import { humannessScore } from '../lib/scoring';
import type { ScoredModel, TableSort, TableSortKey } from '../lib/types';
import { DetailPageLink } from './DetailPageLink';
import { RankPauseIcon, RankPlayIcon } from './icons';
import { ProviderLogo } from './ProviderLogo';
import { RankingVisualizationPanel } from './RankingChart';
import { Reveal } from './Reveal';
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
  /** Full standings in the active sort order (no text/provider filtering). */
  sortedRows: ScoredModel[];
  visibleRows: ScoredModel[];
  totalUniqueVotes: number;
  showAll: boolean;
  focusedModel: ScoredModel | null;
  focusedModelId: string | null;
  playingId: string | null;
  sort: TableSort;
  onSortChange: (key: TableSortKey) => void;
  onToggleShowAll: () => void;
  onSelectModel: (model: ScoredModel) => void;
  onClearFocus: () => void;
  onTogglePlay: (model: ScoredModel) => void;
};

/** "Humanness Rankings" — distribution chart (with a live stats line) and the full sortable table. */
export const RankingsSection = ({
  sortedModels,
  sortedRows,
  visibleRows,
  totalUniqueVotes,
  showAll,
  focusedModel,
  focusedModelId,
  playingId,
  sort,
  onSortChange,
  onToggleShowAll,
  onSelectModel,
  onClearFocus,
  onTogglePlay,
}: RankingsSectionProps) => {
  // One-time "build" trigger: fires once when the table scrolls into view, then
  // the rows cascade in via CSS. Re-sorting/filtering only reorders the
  // already-settled rows, so the build never re-animates.
  const { ref: tableRef, inView: rowsIn } = useReveal<HTMLDivElement>();

  // Selection is sticky only on the dots/rows themselves: pressing anywhere
  // else (empty chart space, the rest of the page) deselects and stops the
  // sample. Escape deselects, and Up/Down step the selection to the
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
      // Don't steal arrows from any focused form control.
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
    ? sortedRows.filter((model) => model.id === focusedModelId)
    : sortedRows;
  // The Human baseline is a reference, not a competitor: it stays out of the
  // counts and the show-all total.
  const rankedModels = sortedModels.filter((m) => !m.baseline);
  const rankedCount = rankedModels.length;
  // No default row highlight: only an explicit selection tints a row, so the
  // baseline's highlight stands alone instead of pairing with an auto-lit #1.
  const tableHighlightId = focusedModelId;
  const providerCount = new Set(rankedModels.map((m) => m.provider)).size;
  const allWins = rankedModels.map((m) => m.wins);

  // Live stats line shown as the chart's subtitle (when nothing is focused),
  // replacing the old standalone counts strip. The (i) tooltip stays on Models.
  const chartStats = (
    <p className="ranking-chart-sub ranking-chart-stats">
      <span className="ranking-chart-stat">
        {rankedCount} Models
        <InfoTip tip="Every listed model offers voice cloning, so each battle can play the same cloned source voice through both sides. Models without cloning can't be compared head to head and are left out; new ones join as cloning access lands." />
      </span>
      <span className="ranking-chart-sep" aria-hidden="true" />
      <span className="ranking-chart-stat">{providerCount} providers</span>
      <span className="ranking-chart-sep" aria-hidden="true" />
      <span className="ranking-chart-stat">
        {totalUniqueVotes.toLocaleString()} unique votes
      </span>
    </p>
  );

  return (
    <section className="long-tail-section" id="rankings" onBlur={handleSectionBlur}>
      {/* Visually hidden, but kept in the DOM as the section's <h2> so the
          heading hierarchy stays intact for SEO and screen readers. The visible
          title and the standalone counts strip were removed by request; the
          counts now live in the chart's subtitle below. */}
      <h2 className="sr-only">Humanness Rankings</h2>
      <Reveal as="p" className="rankings-intro">
        Humanness against measured latency, the highest-scoring voices sit top-right
      </Reveal>

      {/* The chart card reveals as its own step a beat after the intro. */}
      <RankingVisualizationPanel
        rows={rankingRows}
        allModels={sortedModels}
        focusedModel={focusedModel}
        statsLine={chartStats}
        onFocusModel={onSelectModel}
        onClearFocus={onClearFocus}
        revealDelay={140}
      />

      <div
        ref={tableRef}
        className={`ranking-table-wrap rows-reveal${rowsIn ? ' is-in' : ''}`}
      >
        <table className="ranking-table">
          <thead>
            <tr>
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
                <SortHeader label="Price" sortKey="price" sort={sort} onSortChange={onSortChange} />
                <InfoTip tip="Published pay-as-you-go API pricing, in US dollars per 1 million characters. Open-source models show no price." />
              </th>
              <th className="rt-num" aria-sort={ariaSortFor(sort, 'votes')}>
                <SortHeader label="Votes" sortKey="votes" sort={sort} onSortChange={onSortChange} />
                <InfoTip tip="How many listeners picked this voice as more human in blind battles. Rank is set by Elo, which also weights how strong each opponent was, so more votes doesn't always mean a higher rank." />
              </th>
              <th className="rt-listen">Listen</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((model) => {
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
                      model.likelyRank.replace('-', '\u2013')
                    )}
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
      {rankedCount > 10 && (
        <button className="ranking-showall" type="button" onClick={onToggleShowAll}>
          {showAll ? 'Show top 10' : `Show all ${rankedCount}`}
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
