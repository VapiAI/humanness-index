'use client';

import { useState } from 'react';

import { voiceStats } from '../data/providers';
import { clamp, humannessScore, mean, parseLatencyMs } from '../lib/scoring';
import type { ScoredModel } from '../lib/types';
import { ProviderLogo } from './ProviderLogo';

const VisualizationLegend = () => (
  <div className="legend">
    <span>
      <i className="legend-gradient" /> Color = rank
    </span>
    <span>
      <i className="legend-line" /> Average
    </span>
  </div>
);

type RankingVisualizationPanelProps = {
  rows: ScoredModel[];
  allModels: ScoredModel[];
  focusedModel: ScoredModel | null;
  /** Select toggle shared with the table: focuses + plays, or deselects + stops. */
  onFocusModel: (model: ScoredModel) => void;
  onClearFocus: () => void;
};

export const RankingVisualizationPanel = ({
  rows,
  allModels,
  focusedModel,
  onFocusModel,
  onClearFocus,
}: RankingVisualizationPanelProps) => (
  <div className="rankings-visual-panel">
    <div className="ranking-chart-heading">
      <div className="ranking-chart-titles">
        <h3>
          {focusedModel
            ? `${focusedModel.provider} ${focusedModel.model}`
            : 'Humanness distribution'}
        </h3>
        {focusedModel ? (
          <button type="button" className="ranking-chart-clear" onClick={onClearFocus}>
            Clear focus
          </button>
        ) : (
          <p className="ranking-chart-sub">Hover for details or click a dot to hear it</p>
        )}
      </div>
      <VisualizationLegend />
    </div>
    <EloDistributionChart
      models={rows}
      allModels={allModels}
      onFocusModel={onFocusModel}
      onClearFocus={onClearFocus}
    />
  </div>
);

type HoverPoint = {
  id: string;
  model: ScoredModel;
  rank: number;
  xPct: number;
  yPct: number;
  below: boolean;
};

/**
 * Log-scale ms domain: floor the field's min to a nice 1/2/5 value, then
 * double until the max is covered (e.g. 116–758 ms → ticks 100/200/400/800).
 * A log axis keeps every dot at its exact measured value while still
 * spreading the fast cluster, so one slow model can't crush the rest.
 */
const logMsScaleFor = (min: number, max: number) => {
  const pow = 10 ** Math.floor(Math.log10(min));
  const unit = min / pow;
  const lo = (unit >= 5 ? 5 : unit >= 2 ? 2 : 1) * pow;
  const ticks = [lo];
  while (ticks[ticks.length - 1] < max) {
    ticks.push(ticks[ticks.length - 1] * 2);
  }
  return { ticks, lo, hi: ticks[ticks.length - 1] };
};

type EloDistributionChartProps = {
  models: ScoredModel[];
  allModels: ScoredModel[];
  onFocusModel: (model: ScoredModel) => void;
  onClearFocus: () => void;
};

/**
 * Humanness (x) vs. Latency (y, fast = up): the score against the one
 * independent spec. Humanness is min-max normalized to a 0–100 score
 * (left→right, worse→better); latency plots at its exact measured value in
 * real milliseconds on an inverted log axis (fastest at the top), so dot
 * positions always agree with the hover card. Uniform dots at rest; hover
 * any dot for that model's card, click to focus.
 */
const EloDistributionChart = ({
  models,
  allModels,
  onFocusModel,
  onClearFocus,
}: EloDistributionChartProps) => {
  const [hovered, setHovered] = useState<HoverPoint | null>(null);
  const width = 1440;
  const height = 380;
  const left = 88;
  const right = width - 44;
  const top = 30;
  const bottom = height - 64;
  const plotW = right - left;
  const plotH = bottom - top;

  // Only models with a measured TTFB can sit honestly on a latency axis;
  // the rest are listed in the footnote below the plot instead.
  const plottable = allModels.filter((m) => parseLatencyMs(m) !== null);
  const unplotted = allModels.filter((m) => parseLatencyMs(m) === null);

  const elos = allModels.map((m) => m.elo);
  const lats = plottable.map((m) => parseLatencyMs(m) as number);
  const elMin = Math.min(...elos);
  const elMax = Math.max(...elos);
  const elPad = (elMax - elMin) * 0.06 || 4;
  const elLo = elMin - elPad;
  const elHi = elMax + elPad;
  const { ticks: msTicks, lo: msLo, hi: msHi } = logMsScaleFor(
    Math.min(...lats),
    Math.max(...lats),
  );

  const humScore = (elo: number) => clamp((100 * (elo - elLo)) / (elHi - elLo || 1), 0, 100);

  const DOT_RADIUS = 7;

  // Color = rank: rank 1 (best) = mint #00cd8f, last = ocean #2d6bff. t: 1 = best, 0 = worst.
  const rankColor = (t: number) => {
    const channel = (a: number, b: number) => Math.round(b + (a - b) * t);
    return `rgb(${channel(0, 45)}, ${channel(205, 107)}, ${channel(143, 255)})`;
  };

  const avgHum = humScore(mean(elos));
  const avgLatMs = mean(lats);

  const xFor = (score: number) => left + (score / 100) * plotW;
  // Inverted log ms axis: fastest (lowest ms) at the top, slowest at the bottom.
  const yForMs = (ms: number) => {
    const t =
      (Math.log(clamp(ms, msLo, msHi)) - Math.log(msLo)) /
      (Math.log(msHi) - Math.log(msLo) || 1);
    return top + t * plotH;
  };

  const xAxisTicks = [0, 25, 50, 75, 100];

  return (
    <div className="ranking-chart-shell" onClick={onClearFocus}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Humanness versus latency scatter"
      >
        <rect x="0" y="0" width={width} height={height} rx="8" fill="#ffffff" />

        {xAxisTicks.map((tick) => (
          <g key={`x${tick}`}>
            <line x1={xFor(tick)} x2={xFor(tick)} y1={top} y2={bottom} stroke="#eef2f7" />
            <text x={xFor(tick)} y={bottom + 20} textAnchor="middle">
              {tick}
            </text>
          </g>
        ))}
        {msTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line x1={left} x2={right} y1={yForMs(tick)} y2={yForMs(tick)} stroke="#eef2f7" />
            <text x={left - 12} y={yForMs(tick) + 4} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}

        <line x1={left} x2={left} y1={top} y2={bottom} stroke="#cdd7d3" />
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#cdd7d3" />

        <line className="chart-avg-line" x1={xFor(avgHum)} x2={xFor(avgHum)} y1={top} y2={bottom} />
        <text className="chart-avg-label" x={xFor(avgHum) + 6} y={top + 11}>
          Above Average
        </text>
        <line
          className="chart-avg-line"
          x1={left}
          x2={right}
          y1={yForMs(avgLatMs)}
          y2={yForMs(avgLatMs)}
        />

        <text className="chart-axis-label" x={left + plotW / 2} y={bottom + 46} textAnchor="middle">
          Humanness
        </text>
        <text className="chart-end-label" x={left} y={bottom + 34} textAnchor="start">
          Worse
        </text>
        <text className="chart-end-label" x={right} y={bottom + 34} textAnchor="end">
          Better
        </text>
        <text
          className="chart-axis-label"
          x={22}
          y={top + plotH / 2}
          textAnchor="middle"
          transform={`rotate(-90 22 ${top + plotH / 2})`}
        >
          Latency (ms, log scale)
        </text>
        <text
          className="chart-end-label"
          x={44}
          y={top + 16}
          textAnchor="middle"
          transform={`rotate(-90 44 ${top + 16})`}
        >
          Faster
        </text>
        <text
          className="chart-end-label"
          x={44}
          y={bottom - 16}
          textAnchor="middle"
          transform={`rotate(-90 44 ${bottom - 16})`}
        >
          Slower
        </text>

        {plottable.map((model) => {
          const matched = models.some((m) => m.id === model.id);
          // Ring + size bump on hover only; dots are uniform at rest (Figma).
          const hoveredThis = hovered?.id === model.id;
          const bright = matched || hoveredThis;
          const rank = allModels.findIndex((m) => m.id === model.id) + 1;
          const span = Math.max(allModels.length - 1, 1);
          const intensity = clamp(1 - (rank - 1) / span, 0, 1); // 1 = rank 1 (mint), 0 = worst (ocean)
          const dotFill = rankColor(intensity);
          const cx = xFor(humScore(model.elo));
          const cy = yForMs(parseLatencyMs(model) as number);
          const point: HoverPoint = {
            id: model.id,
            model,
            rank,
            xPct: clamp((cx / width) * 100, 14, 86),
            yPct: (cy / height) * 100,
            below: cy < height * 0.42,
          };
          return (
            <g key={model.id} className="chart-dot-group" opacity={bright ? 1 : 0.25}>
              <circle
                className="chart-point"
                cx={cx}
                cy={cy}
                r={hoveredThis ? DOT_RADIUS + 2 : DOT_RADIUS}
                style={{ fill: dotFill }}
                stroke={hoveredThis ? '#1a1a2e' : '#ffffff'}
                strokeWidth={hoveredThis ? 2.5 : 1.5}
                tabIndex={0}
                role="button"
                aria-label={`#${rank} ${model.provider} ${model.model}, Humanness ${humannessScore(model, allModels)}, latency ${voiceStats(model).latency}`}
                onMouseEnter={() => setHovered(point)}
                onMouseLeave={() => setHovered((h) => (h?.id === model.id ? null : h))}
                onFocus={() => setHovered(point)}
                onBlur={() => setHovered((h) => (h?.id === model.id ? null : h))}
                onClick={(event) => {
                  event.stopPropagation();
                  onFocusModel(model);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onFocusModel(model);
                  }
                }}
              />
            </g>
          );
        })}
      </svg>
      {unplotted.length > 0 && (
        <p className="chart-foot">
          Not plotted (no public streaming API to measure):{' '}
          {unplotted
            .map((m) =>
              m.model.startsWith(m.provider.split(/\s/)[0])
                ? m.model
                : `${m.provider} ${m.model}`,
            )
            .join(', ')}
          .
        </p>
      )}
      {hovered && (
        <div
          className="chart-hover-card"
          data-below={hovered.below ? 'true' : undefined}
          style={{ left: `${hovered.xPct}%`, top: `${hovered.yPct}%` }}
        >
          <div className="chc-head">
            <span className="chc-logo">
              <ProviderLogo provider={hovered.model.provider} />
            </span>
            <div className="chc-id">
              <span className="chc-name">{hovered.model.provider}</span>
              <span className="chc-model">{hovered.model.model}</span>
            </div>
            <span className="chc-rank">#{hovered.rank}</span>
          </div>
          <div className="chc-row">
            <span className="chc-key">Humanness</span>
            <span className="chc-val chc-val-hl">{humannessScore(hovered.model, allModels)}</span>
          </div>
          <div className="chc-row">
            <span className="chc-key">Latency</span>
            <span className="chc-val">{voiceStats(hovered.model).latency}</span>
          </div>
          <div className="chc-row">
            <span className="chc-key">Languages</span>
            <span className="chc-val">{voiceStats(hovered.model).langs}</span>
          </div>
        </div>
      )}
    </div>
  );
};
