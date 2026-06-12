/**
 * The production voice visualizers: segmented bursts whose core disc is
 * filled with a moving, brand-colored background, plus ring/ribbon
 * variants. Each provider gets one SHORTLIST visualizer as its signature
 * (see PROVIDER_VIZ), so a brand's voices share a look across the page.
 *
 * These five shipped from a larger exploration gallery that stays out of
 * the public repo; the drawing primitives live in ./voiceViz.
 */
import {
  drawBurst,
  drawHelix,
  drawWaveRing,
  TAU,
  type DrawFn,
  type VizShape,
} from './voiceViz';
import type { ArenaRow, Palette } from './types';

type FillFn = (
  ctx: CanvasRenderingContext2D,
  t: number,
  size: number,
  pal: Palette,
  c: number,
  r: number,
) => void;

const base = (
  ctx: CanvasRenderingContext2D,
  c: number,
  r: number,
  col: string,
  alpha: number,
) => {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = col;
  ctx.fillRect(c - r, c - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
};

// polyline helper: walk x across the disc, y from fn(x)
const poly = (
  ctx: CanvasRenderingContext2D,
  c: number,
  r: number,
  stepX: number,
  fn: (x: number) => number,
) => {
  ctx.beginPath();
  let first = true;
  for (let x = c - r; x <= c + r; x += stepX) {
    const y = fn(x);
    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
};

// lite-flow: soft, airy pastel gradient with light highlights
const fillLiteFlow: FillFn = (ctx, t, _size, pal, c, r) => {
  base(ctx, c, r, pal.mid, 0.45);
  const blobs: Array<[string, number, number]> = [
    ['rgba(255,255,255,0.9)', 0.03, 0],
    [pal.from, 0.042, 2],
    [pal.mid, 0.05, 4],
  ];
  blobs.forEach(([col, sp, ph]) => {
    const x = c + Math.cos(t * sp + ph) * r * 0.7;
    const y = c + Math.sin(t * sp * 1.4 + ph) * r * 0.7;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.95);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = g;
    ctx.fillRect(c - r, c - r, r * 2, r * 2);
  });
  ctx.globalAlpha = 1;
};

const fillLiteFlowWave: FillFn = (ctx, t, size, pal, c, r) => {
  fillLiteFlow(ctx, t, size, pal, c, r);
  ctx.strokeStyle = pal.from;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.9;
  ctx.shadowBlur = 6;
  ctx.shadowColor = pal.mid;
  poly(ctx, c, r, 1.5, (x) => {
    const u = (x - c) / r;
    return c + Math.sin(u * 13 + t * 0.06) * Math.cos(u * 1.4) * r * 0.46;
  });
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
};

// One waveform, mirrored top/bottom like the waveform ring, with a beating (AM) envelope.
const fillBeatingSingle: FillFn = (ctx, t, _size, pal, c, r) => {
  base(ctx, c, r, pal.to, 0.18);
  ctx.strokeStyle = pal.from;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.shadowBlur = 5;
  ctx.shadowColor = pal.mid;
  for (let x = c - r; x <= c + r; x += 3) {
    const u = (x - c) / r;
    const beat = Math.abs(Math.cos(u * 2.4 - t * 0.02)); // slow envelope → beat nodes, traveling
    const wob = 0.5 + 0.5 * Math.sin(u * 28 + t * 0.06); // fast per-bar carrier
    const h = beat * wob * r * 0.82;
    ctx.globalAlpha = 0.4 + 0.6 * beat;
    ctx.beginPath();
    ctx.moveTo(x, c - h);
    ctx.lineTo(x, c + h);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
};

const fillHelixCenter: FillFn = (ctx, t, size, pal, c, r) => {
  base(ctx, c, r, pal.to, 0.14);
  ctx.save();
  ctx.translate(c, c);
  ctx.scale(0.56, 0.56);
  ctx.translate(-c, -c);
  drawHelix(ctx, t * 0.5, size, pal, {}, { noCore: true });
  ctx.restore();
};

const withCenter =
  (fill: FillFn): DrawFn =>
  (ctx, t, size, pal, fp) => {
    const c = size / 2;
    const r = size * 0.22;
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r - 1, 0, TAU);
    ctx.clip();
    fill(ctx, t, size, pal, c, r);
    ctx.restore();
    drawBurst(ctx, t, size, pal, fp);
  };

const helixNoDot: DrawFn = (ctx, t, size, pal, fp) =>
  drawHelix(ctx, t * 0.5, size, pal, fp, { noCore: true });

const waveRingSlow: DrawFn = (ctx, t, size, pal, fp) =>
  drawWaveRing(ctx, t * 0.25, size, pal, fp);

// Sine ribbon framed by a circle (the ring from the waveform ring).
const sineRibbonRinged: DrawFn = (ctx, t, size, pal, fp) => {
  const c = size / 2;
  const R = size * 0.4;
  ctx.lineWidth = 2.5;
  ctx.shadowBlur = 9;
  ctx.shadowColor = pal.mid;
  const rg = ctx.createLinearGradient(c - R, 0, c + R, 0);
  rg.addColorStop(0, pal.from);
  rg.addColorStop(1, pal.to);
  ctx.strokeStyle = rg;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, TAU);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.translate(c, c);
  ctx.scale(0.82, 0.82);
  ctx.translate(-c, -c);
  helixNoDot(ctx, t, size, pal, fp);
  ctx.restore();
};

/** The five production visualizer signatures. */
export const SHORTLIST: VizShape[] = [
  { id: 'liteflow-wave', name: 'Lite-flow + wave', note: 'Pastel flow with a waveform through it.', draw: withCenter(fillLiteFlowWave) },
  { id: 'beating-single', name: 'Beating waveform', note: 'One amplitude-modulated wave.', draw: withCenter(fillBeatingSingle) },
  { id: 'sine-ribbon', name: 'Sine ribbon', note: 'Mirrored sine waves, framed by a ring.', draw: sineRibbonRinged },
  { id: 'wave-ring-slow', name: 'Waveform ring', note: 'Neon ring + waveform, slowed.', draw: waveRingSlow },
  { id: 'burst-ribbon', name: 'Burst + sine ribbon', note: 'Segmented burst framing a sine ribbon.', draw: withCenter(fillHelixCenter) },
];

const SHORTLIST_BY_ID = Object.fromEntries(SHORTLIST.map((s) => [s.id, s]));

// Each provider gets one shortlist visualizer as its signature, so a brand's
// voices share a look and all five are spread across the page. Providers
// without a row fall back to the first shortlist entry.
const PROVIDER_VIZ: Record<string, string> = {
  ElevenLabs: 'burst-ribbon',
  xAI: 'beating-single',
  Cartesia: 'wave-ring-slow',
  Inworld: 'sine-ribbon',
  'Canopy Labs': 'liteflow-wave',
  MiniMax: 'burst-ribbon',
  Gradium: 'sine-ribbon',
};

export const vizForModel = (model: Pick<ArenaRow, 'provider'>): VizShape =>
  SHORTLIST_BY_ID[PROVIDER_VIZ[model.provider]] ?? SHORTLIST[0];
