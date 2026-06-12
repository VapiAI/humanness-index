/**
 * Shared voice-visualization engine: neon canvas "shapes" + palettes, plus the
 * per-voice fingerprint that assigns and tunes them. Used by the index page
 * (via lib/burstFills.ts) for every model's signature visualizer.
 */
import type { ArenaRow, Palette, VoiceFingerprint } from './types';

export const TAU = Math.PI * 2;

type DrawOptions = { noCore?: boolean };

export type DrawFn = (
  ctx: CanvasRenderingContext2D,
  t: number,
  size: number,
  palette: Palette,
  fingerprint?: Partial<VoiceFingerprint>,
) => void;

export type VizShape = {
  id: string;
  name: string;
  note: string;
  draw: DrawFn;
};

/**
 * Each palette is a TIGHT single-hue ramp (brand color → lighter → deeper).
 * Keeping all three stops in one hue means the gradients and glow stay vibrant
 * instead of muddying through the desaturated grey you get when you blend
 * across distant hues (e.g. green→blue) in RGB.
 */
export const PALETTES = {
  mint: { name: 'Mint', from: '#00cd8f', mid: '#5ef0c4', to: '#00a06f' },
  teal: { name: 'Teal', from: '#14b8a6', mid: '#5eead4', to: '#0d9488' },
  ocean: { name: 'Ocean', from: '#2d6bff', mid: '#74a0ff', to: '#1b46cc' },
  sunset: { name: 'Sunset', from: '#ff9633', mid: '#ffc176', to: '#e0701a' },
  meadow: { name: 'Meadow', from: '#86d916', mid: '#c4f25c', to: '#5f9e0a' },
  coral: { name: 'Coral', from: '#fb5f7f', mid: '#ffa0b4', to: '#ec2f52' },
  violet: { name: 'Violet', from: '#8b5cf6', mid: '#c4b5fd', to: '#6d28d9' },
  gold: { name: 'Gold', from: '#e8b00f', mid: '#ffd95e', to: '#b07d08' },
} satisfies Record<string, Palette>;

const PALETTE_LIST: Palette[] = [
  PALETTES.mint,
  PALETTES.ocean,
  PALETTES.sunset,
  PALETTES.meadow,
  PALETTES.coral,
  PALETTES.violet,
  PALETTES.gold,
];

/**
 * Vapi brand colors (from the brand guidelines) — each is a solid brand swatch
 * plus a tight single-hue ramp the visualizers draw with.
 */
export const VAPI_BRAND: Array<Palette & { swatch: string }> = [
  { name: 'Cream', swatch: '#faf9f6', from: '#ffffff', mid: '#faf9f6', to: '#e7e1d3' },
  { name: 'Black', swatch: '#1a1a2e', from: '#3b3b54', mid: '#5c5c78', to: '#1a1a2e' },
  { name: 'Mint', swatch: '#00cd8f', from: '#00cd8f', mid: '#5ef0c4', to: '#00a06f' },
  { name: 'Ocean', swatch: '#2d6bff', from: '#2d6bff', mid: '#74a0ff', to: '#1b46cc' },
  { name: 'Sunset', swatch: '#ef8e44', from: '#ef8e44', mid: '#ffc28a', to: '#d96f1f' },
  { name: 'Lavender', swatch: '#c4b5fd', from: '#c4b5fd', mid: '#ddd0ff', to: '#a78bfa' },
];

const hexLerp = (a: string, b: string, amount: number) => {
  const pa = [
    parseInt(a.slice(1, 3), 16),
    parseInt(a.slice(3, 5), 16),
    parseInt(a.slice(5, 7), 16),
  ];
  const pb = [
    parseInt(b.slice(1, 3), 16),
    parseInt(b.slice(3, 5), 16),
    parseInt(b.slice(5, 7), 16),
  ];
  const r = pa.map((v, i) => Math.round(v + (pb[i] - v) * amount));
  return `rgb(${r[0]}, ${r[1]}, ${r[2]})`;
};

const glowCore = (
  ctx: CanvasRenderingContext2D,
  c: number,
  r: number,
  pal: Palette,
) => {
  ctx.shadowBlur = 16;
  ctx.shadowColor = pal.from;
  const g = ctx.createRadialGradient(c, c, 0, c, c, r);
  g.addColorStop(0, pal.from); // brand-colored core reads on light or dark wells
  g.addColorStop(0.55, pal.mid);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
};

// Each draw takes (ctx, frame, size, palette, fingerprint). The fingerprint
// seeds the pattern + speed so two voices sharing a shape still look different.

const drawBars: DrawFn = (ctx, t, size, pal, fp = {}) => {
  const seed = fp.p || 0;
  const sp = fp.speed || 1;
  const c = size / 2;
  const n = 72;
  const inner = size * 0.2;
  const max = size * 0.22;
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU;
    const env =
      0.35 + 0.65 * Math.abs(Math.sin(i * 0.7 + seed) + 0.5 * Math.sin(i * 0.23 + seed));
    const amp = 0.5 + 0.5 * Math.sin(t * 0.05 * sp + i * 0.35 + seed);
    const len = inner + env * max * (0.4 + 0.6 * amp);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const x1 = c + cos * inner;
    const y1 = c + sin * inner;
    const x2 = c + cos * len;
    const y2 = c + sin * len;
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, pal.from);
    g.addColorStop(1, pal.to);
    ctx.strokeStyle = g;
    ctx.shadowBlur = 6;
    ctx.shadowColor = pal.mid;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  glowCore(ctx, c, size * 0.12, pal);
};

export const drawBurst: DrawFn = (ctx, t, size, pal, fp = {}) => {
  const seed = fp.p || 0;
  const sp = fp.speed || 1;
  const c = size / 2;
  const n = 88;
  const inner = size * 0.22;
  const max = size * 0.22;
  ctx.shadowBlur = 6;
  ctx.shadowColor = pal.from;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU;
    ctx.fillStyle = hexLerp(pal.from, pal.to, i / n);
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * inner, c + Math.sin(a) * inner, 1.3, 0, TAU);
    ctx.fill();
  }
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'butt';
  const seg = 4;
  const gap = 3;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU;
    const env = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.5 + 1 + seed)) ** 1.4;
    const amp = 0.5 + 0.5 * Math.sin(t * 0.06 * sp + i * 0.5 + seed);
    const end = inner + 6 + env * max * (0.45 + 0.55 * amp);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.strokeStyle = hexLerp(pal.from, pal.to, i / n);
    ctx.shadowBlur = 5;
    ctx.shadowColor = pal.mid;
    let r = inner + 6;
    while (r < end) {
      const r2 = Math.min(r + seg, end);
      ctx.beginPath();
      ctx.moveTo(c + cos * r, c + sin * r);
      ctx.lineTo(c + cos * r2, c + sin * r2);
      ctx.stroke();
      r += seg + gap;
    }
  }
};

export const drawWaveRing: DrawFn = (ctx, t, size, pal, fp = {}) => {
  const seed = fp.p || 0;
  const sp = fp.speed || 1;
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
  const n = 46;
  const span = R * 1.5;
  const x0 = c - span / 2;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i += 1) {
    const x = x0 + (i / (n - 1)) * span;
    const env = Math.sin((i / (n - 1)) * Math.PI);
    const h = env * (size * 0.17) * Math.abs(Math.sin(t * 0.08 * sp + i * 0.42 + seed));
    const col = hexLerp(pal.from, pal.to, i / (n - 1));
    ctx.strokeStyle = col;
    ctx.shadowBlur = 6;
    ctx.shadowColor = col;
    ctx.beginPath();
    ctx.moveTo(x, c - h - 1);
    ctx.lineTo(x, c + h + 1);
    ctx.stroke();
  }
};

const drawSpiky: DrawFn = (ctx, t, size, pal, fp = {}) => {
  const seed = fp.p || 0;
  const sp = fp.speed || 1;
  const c = size / 2;
  const n = 120;
  const inner = size * 0.16;
  const max = size * 0.27;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU;
    const noise = Math.abs(Math.sin(i * 1.7 + seed) * Math.cos(i * 0.9 + seed));
    const amp = 0.5 + 0.5 * Math.sin(t * 0.07 * sp + i * 0.8 + seed);
    const len = inner + (0.2 + 0.8 * noise) * max * (0.4 + 0.6 * amp);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const col = hexLerp(pal.from, pal.to, noise);
    ctx.strokeStyle = col;
    ctx.shadowBlur = 5;
    ctx.shadowColor = col;
    ctx.beginPath();
    ctx.moveTo(c + cos * inner, c + sin * inner);
    ctx.lineTo(c + cos * len, c + sin * len);
    ctx.stroke();
  }
  glowCore(ctx, c, size * 0.1, pal);
};

const drawSonar: DrawFn = (ctx, t, size, pal, fp = {}) => {
  const sp = fp.speed || 1;
  const c = size / 2;
  const maxR = size * 0.42;
  ctx.lineWidth = 1;
  for (let k = 1; k <= 4; k += 1) {
    ctx.strokeStyle = hexLerp(pal.from, pal.to, k / 4);
    ctx.globalAlpha = 0.35;
    ctx.shadowBlur = 4;
    ctx.shadowColor = pal.mid;
    ctx.beginPath();
    ctx.arc(c, c, (maxR * k) / 4, 0, TAU);
    ctx.stroke();
  }
  const ping = ((t * 1.2 * sp) % 120) / 120;
  ctx.globalAlpha = 1 - ping;
  ctx.strokeStyle = pal.from;
  ctx.lineWidth = 2;
  ctx.shadowBlur = 12;
  ctx.shadowColor = pal.from;
  ctx.beginPath();
  ctx.arc(c, c, ping * maxR, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate((t * 0.03 * sp) % TAU);
  const lg = ctx.createLinearGradient(0, 0, maxR, 0);
  lg.addColorStop(0, 'rgba(0,0,0,0)');
  lg.addColorStop(1, pal.to);
  ctx.strokeStyle = lg;
  ctx.lineWidth = 2;
  ctx.shadowBlur = 10;
  ctx.shadowColor = pal.to;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(maxR, 0);
  ctx.stroke();
  ctx.restore();
  glowCore(ctx, c, size * 0.08, pal);
};

const drawRibbon: DrawFn = (ctx, t, size, pal, fp = {}) => {
  const seed = fp.p || 0;
  const sp = fp.speed || 1;
  const c = size / 2;
  const petals = 6; // single harmonic → clean N-fold rotational symmetry (no amoeba)
  const base = size * 0.27;
  const amp = size * 0.085;
  const rot = t * 0.012 * sp + seed;
  const pulse = 0.92 + 0.08 * Math.sin(t * 0.05 * sp + seed);
  const n = 180;
  const bloom = (scale: number) => {
    ctx.beginPath();
    for (let i = 0; i <= n; i += 1) {
      const a = (i / n) * TAU;
      const r = (base + amp * Math.sin(petals * a + rot)) * pulse * scale;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  bloom(1);
  const fillG = ctx.createRadialGradient(c, c, base * 0.2, c, c, base + amp);
  fillG.addColorStop(0, pal.from);
  fillG.addColorStop(0.7, pal.mid);
  fillG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fillG;
  ctx.globalAlpha = 0.42;
  ctx.fill();
  ctx.globalAlpha = 1;
  const strokeG = ctx.createLinearGradient(c - base, c - base, c + base, c + base);
  strokeG.addColorStop(0, pal.from);
  strokeG.addColorStop(1, pal.to);
  ctx.strokeStyle = strokeG;
  ctx.lineWidth = 2.4;
  ctx.shadowBlur = 14;
  ctx.shadowColor = pal.mid;
  ctx.stroke();
  bloom(0.62);
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  glowCore(ctx, c, size * 0.12, pal);
};

export const drawHelix = (
  ctx: CanvasRenderingContext2D,
  t: number,
  size: number,
  pal: Palette,
  fp: Partial<VoiceFingerprint> = {},
  opts: DrawOptions = {},
) => {
  const seed = fp.p || 0;
  const sp = fp.speed || 1;
  const c = size / 2;
  const span = size * 0.74;
  const x0 = c - span / 2;
  const amp = size * 0.16;
  const n = 80;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 2; pass += 1) {
    const dir = pass === 0 ? 1 : -1;
    ctx.beginPath();
    for (let i = 0; i <= n; i += 1) {
      const x = x0 + (i / n) * span;
      const env = Math.sin((i / n) * Math.PI);
      const y = c + dir * Math.sin((i / n) * TAU * 2 + t * 0.07 * sp + seed) * amp * env;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const g = ctx.createLinearGradient(x0, 0, x0 + span, 0);
    g.addColorStop(0, pal.from);
    g.addColorStop(1, pal.to);
    ctx.strokeStyle = g;
    ctx.shadowBlur = 12;
    ctx.shadowColor = pass === 0 ? pal.from : pal.to;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  if (!opts.noCore) glowCore(ctx, c, size * 0.09, pal);
};

const drawOrbit: DrawFn = (ctx, t, size, pal, fp = {}) => {
  const seed = fp.p || 0;
  const sp = fp.speed || 1;
  const c = size / 2;
  const rings = 3;
  for (let k = 1; k <= rings; k += 1) {
    const rr = (size * 0.4 * k) / rings;
    ctx.strokeStyle = hexLerp(pal.from, pal.to, k / rings);
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(c, c, rr, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const count = 2 + k * 2;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * TAU + t * 0.04 * sp * (k % 2 ? 1 : -1) + seed;
      const x = c + Math.cos(a) * rr;
      const y = c + Math.sin(a) * rr;
      ctx.fillStyle = hexLerp(pal.from, pal.to, k / rings);
      ctx.shadowBlur = 10;
      ctx.shadowColor = pal.mid;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, TAU);
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
  glowCore(ctx, c, size * 0.11, pal);
};

export const SHAPES: VizShape[] = [
  { id: 'bars', name: 'Equalizer ring', note: 'Radial gradient bars + glow', draw: drawBars },
  { id: 'burst', name: 'Segmented burst', note: 'Dashed sun-rays from a dotted core', draw: drawBurst },
  { id: 'wave', name: 'Waveform ring', note: 'Neon ring framing a waveform', draw: drawWaveRing },
  { id: 'spiky', name: 'Spiky halo', note: 'Dense organic neon spikes', draw: drawSpiky },
  { id: 'sonar', name: 'Sonar pulse', note: 'Concentric rings + ping + sweep', draw: drawSonar },
  { id: 'ribbon', name: 'Petal bloom', note: 'Symmetric petalled bloom', draw: drawRibbon },
  { id: 'helix', name: 'Sine ribbon', note: 'Mirrored tapered sine waves', draw: drawHelix },
  { id: 'orbit', name: 'Particle orbit', note: 'Dots orbiting concentric rings', draw: drawOrbit },
];

// Each provider (brand) gets one signature waveform — every model from that
// brand shares it, so ElevenLabs, Cartesia, xAI… are recognizable by shape alone.
const SHAPE_BY_ID = Object.fromEntries(SHAPES.map((s) => [s.id, s]));

const PROVIDER_SHAPE: Record<string, string> = {
  ElevenLabs: 'burst',
  xAI: 'bars',
  Cartesia: 'wave',
  Inworld: 'spiky',
  'Canopy Labs': 'ribbon',
  MiniMax: 'orbit',
  Gradium: 'helix',
};

const shapeForProvider = (provider: string): VizShape => {
  const mapped = SHAPE_BY_ID[PROVIDER_SHAPE[provider]];
  if (mapped) return mapped;
  // Deterministic fallback so any unmapped brand is still consistent across its models.
  let h = 0;
  for (let i = 0; i < provider.length; i += 1) {
    h = (h * 31 + provider.charCodeAt(i)) % SHAPES.length;
  }
  return SHAPES[h];
};

// Like the shape, each brand also gets ONE signature color ramp, so all of a
// provider's models read as the same family. (The blind battle / result cards
// override this with the teal-vs-sunset A/B story — that's intentional.)
const PROVIDER_PALETTE: Record<string, Palette> = {
  xAI: PALETTES.violet,
  ElevenLabs: PALETTES.coral,
  Cartesia: PALETTES.teal,
  MiniMax: PALETTES.gold,
  Gradium: PALETTES.sunset,
  'Canopy Labs': PALETTES.meadow,
  Inworld: PALETTES.mint,
};

const paletteForProvider = (provider: string): Palette => {
  const mapped = PROVIDER_PALETTE[provider];
  if (mapped) return mapped;
  // Deterministic fallback so any unmapped brand is still consistent across its models.
  let h = 0;
  for (let i = 0; i < provider.length; i += 1) {
    h = (h * 31 + provider.charCodeAt(i)) % PALETTE_LIST.length;
  }
  return PALETTE_LIST[h];
};

/**
 * Turn a voice into a visual fingerprint: `p` seeds each shape's pattern and
 * `speed` (derived from the voice's "energy") sets its animation pace, so two
 * voices sharing a shape still look different.
 */
export const voiceFingerprint = (
  model: Pick<ArenaRow, 'voiceProfile'>,
): VoiceFingerprint => {
  const p = model.voiceProfile || 1;
  const energy = ((p * 29) % 100) / 100;
  return { p, speed: Number((0.6 + energy * 1.3).toFixed(3)) };
};

/**
 * Both shape and color are brand signatures (one of each per provider), so
 * every model from a brand shares a single visual identity. Per-model variety
 * comes from the fingerprint (seed/speed), not the palette.
 */
export const voiceStyle = (model: Pick<ArenaRow, 'provider' | 'voiceProfile'>) => ({
  shape: shapeForProvider(model.provider),
  palette: paletteForProvider(model.provider),
});

// One shared ~30fps clock drives every canvas, so many cards animating at once
// stay cheap (one rAF loop instead of one per card).
const vizSubscribers = new Set<(frame: number) => void>();
let vizRunning = false;
let vizLast = 0;
let vizFrame = 0;

const vizLoop = (now: number) => {
  if (now - vizLast >= 33) {
    vizLast = now;
    vizFrame += 1;
    vizSubscribers.forEach((fn) => fn(vizFrame));
  }
  if (vizSubscribers.size) {
    window.requestAnimationFrame(vizLoop);
  } else {
    vizRunning = false;
  }
};

export const subscribeViz = (fn: (frame: number) => void) => {
  vizSubscribers.add(fn);
  if (!vizRunning) {
    vizRunning = true;
    window.requestAnimationFrame(vizLoop);
  }
  return () => {
    vizSubscribers.delete(fn);
  };
};
