/**
 * Voice-visualization engine: the brand palettes, the per-voice fingerprint
 * that tunes the animation, the amplitude-reactive gradient orb every model
 * renders, and the shared ~60fps clock that drives the playing orbs.
 */
import type { ArenaRow, Palette, VoiceFingerprint } from './types';

const TAU = Math.PI * 2;

// Rounded-square (superellipse) radius factors per outline step, normalized so
// the corners sit on the unit circle and the flat sides pull inward. Blending
// the orb's outline toward this makes a low-Humanness voice read as a rigid
// rounded square while a high-Humanness one stays an organic circle. Fixed
// orientation (it doesn't spin with the wobble) and precomputed once for the
// 72-step outline so the per-frame draw stays cheap. n=4 keeps it a soft
// squircle, never a hard square.
const SQUIRCLE_N = 4;
const SQUIRCLE = ((): number[] => {
  const raw: number[] = [];
  for (let i = 0; i <= 72; i += 1) {
    const ang = (i / 72) * TAU;
    raw.push(
      1 /
        (Math.abs(Math.cos(ang)) ** SQUIRCLE_N +
          Math.abs(Math.sin(ang)) ** SQUIRCLE_N) **
          (1 / SQUIRCLE_N),
    );
  }
  const max = Math.max(...raw);
  return raw.map((f) => f / max);
})();

/**
 * Map a Humanness score (0 = field floor, 100 = Human baseline, and above 100
 * for a super-human voice) to the orb's "squareness" (0 = round/organic,
 * 1 = rounded-square). Higher Humanness reads as rounder/more human; lower
 * reads as more rigid/synthetic. Clamped, so a super-human score (>100) simply
 * reads as fully round.
 */
export const orbSquareness = (humanness: number) =>
  Math.max(0, Math.min(1, 1 - humanness / 100));

/**
 * The allowed orb colors, all drawn from the site palette: a cohesive
 * green → teal → blue → violet cool arc (the same family as the rankings
 * chart's mint→ocean rank gradient) plus the one warm sunset accent. Each is
 * a TIGHT single-hue ramp (brand color → lighter → deeper) so the gradients
 * stay vibrant instead of muddying through grey. No off-brand pink/yellow/lime.
 */
export const PALETTES = {
  mint: { name: 'Mint', from: '#00cd8f', mid: '#5fe9bf', to: '#00a06f' },
  emerald: { name: 'Emerald', from: '#10b981', mid: '#5fd6a6', to: '#0a8a60' },
  teal: { name: 'Teal', from: '#14b8a6', mid: '#5eead4', to: '#0d9488' },
  cyan: { name: 'Cyan', from: '#06b6c9', mid: '#66dceb', to: '#0a8294' },
  sky: { name: 'Sky', from: '#3b9bff', mid: '#8ec2ff', to: '#2477e0' },
  ocean: { name: 'Ocean', from: '#2d6bff', mid: '#74a0ff', to: '#1b46cc' },
  indigo: { name: 'Indigo', from: '#5b6cf0', mid: '#98a2f7', to: '#3f49c8' },
  violet: { name: 'Violet', from: '#8b6cf0', mid: '#c0b0f8', to: '#6a45cf' },
  sunset: { name: 'Sunset', from: '#ef8e44', mid: '#ffc28a', to: '#d96f1f' },
} satisfies Record<string, Palette>;

const PALETTE_LIST: Palette[] = [
  PALETTES.mint,
  PALETTES.emerald,
  PALETTES.teal,
  PALETTES.cyan,
  PALETTES.sky,
  PALETTES.ocean,
  PALETTES.indigo,
  PALETTES.violet,
  PALETTES.sunset,
];

// Each brand gets ONE signature ramp from the cool arc (sunset is the lone
// warm, reserved for Gradium), so the leaderboard reads as one family rather
// than a rainbow. (The blind battle cards override this with the teal-vs-sunset
// A/B story — that's intentional.)
const PROVIDER_PALETTE: Record<string, Palette> = {
  Inworld: PALETTES.mint,
  'Canopy Labs': PALETTES.emerald,
  Cartesia: PALETTES.teal,
  Neuphonic: PALETTES.cyan,
  'Smallest.ai': PALETTES.sky,
  ElevenLabs: PALETTES.ocean,
  MiniMax: PALETTES.indigo,
  xAI: PALETTES.violet,
  Gradium: PALETTES.sunset,
};

const paletteForProvider = (provider: string): Palette => {
  const mapped = PROVIDER_PALETTE[provider];
  if (mapped) return mapped;
  // Deterministic fallback so any unmapped brand stays consistent across its models.
  let h = 0;
  for (let i = 0; i < provider.length; i += 1) {
    h = (h * 31 + provider.charCodeAt(i)) % PALETTE_LIST.length;
  }
  return PALETTE_LIST[h];
};

/**
 * Turn a voice into a visual fingerprint: `p` seeds the orb's morph phase and
 * `speed` (derived from the voice's "energy") sets its idle drift pace, so two
 * voices from the same brand still look subtly different.
 */
export const voiceFingerprint = (
  model: Pick<ArenaRow, 'voiceProfile'>,
): VoiceFingerprint => {
  const p = model.voiceProfile || 1;
  const energy = ((p * 29) % 100) / 100;
  return { p, speed: Number((0.6 + energy * 1.3).toFixed(3)) };
};

/** The brand color ramp a model's orb draws with. */
export const voiceStyle = (model: Pick<ArenaRow, 'provider' | 'voiceProfile'>) => ({
  palette: paletteForProvider(model.provider),
});

const hexA = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * The gradient orb every model renders. Calm and softly breathing at rest;
 * while a clip plays, `level` (smoothed RMS amplitude, 0..1) swells the core,
 * widens the organic wobble, and blooms the surrounding glow so it pulses with
 * the voice. The fingerprint seeds the morph so each voice's orb differs.
 */
export const drawOrb = (
  ctx: CanvasRenderingContext2D,
  frame: number,
  size: number,
  pal: Palette,
  level: number,
  fp: Partial<VoiceFingerprint> = {},
  // 0 = round/organic, 1 = rounded-square. Derived from Humanness on the cards
  // and the detail page; the blind battle orbs leave it at 0 (no score to bind).
  squareness = 0,
) => {
  const c = size / 2;
  const seed = fp.p ?? 0;
  const sp = fp.speed ?? 1;
  const lvl = Math.max(0, Math.min(1, level));
  const sq = Math.max(0, Math.min(1, squareness));
  const breathe = 1 + 0.018 * Math.sin(frame * 0.04 + seed);
  // The core swells with amplitude; the slightly smaller base radius leaves
  // headroom so loud peaks (plus the wobble below) never clip the canvas edge.
  const R = size * 0.26 * breathe * (1 + 0.17 * lvl);

  // Outer glow halo — blooms with amplitude (fades to 0 alpha, so its reach can
  // exceed the core without a hard edge).
  const haloR = R * (1.5 + 0.55 * lvl);
  const halo = ctx.createRadialGradient(c, c, R * 0.5, c, c, haloR);
  halo.addColorStop(0, hexA(pal.from, 0.16 + 0.42 * lvl));
  halo.addColorStop(1, hexA(pal.from, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(c, c, haloR, 0, TAU);
  ctx.fill();

  // Three morphing layers, back to front: translucent halo skins over a solid core.
  const layers = [
    { rr: 1.32, k: 5, wob: 0.085, alpha: 0.16, inner: pal.to, outer: pal.to },
    { rr: 1.15, k: 4, wob: 0.065, alpha: 0.34, inner: pal.mid, outer: pal.to },
    { rr: 1.0, k: 3, wob: 0.05, alpha: 0.97, inner: pal.mid, outer: pal.from },
  ];
  layers.forEach((layer, idx) => {
    const lr = R * layer.rr;
    const wob = layer.wob * (1 + 1.2 * lvl);
    const spin = frame * 0.016 * (idx + 1) * sp + seed + idx;
    ctx.beginPath();
    for (let i = 0; i <= 72; i += 1) {
      const ang = (i / 72) * TAU;
      const m =
        1 +
        wob * Math.sin(ang * layer.k + spin) +
        wob * 0.5 * Math.sin(ang * (layer.k + 2) - spin * 0.7);
      // Blend the outline toward the fixed rounded-square as squareness rises.
      const shape = 1 + (SQUIRCLE[i] - 1) * sq;
      const r = lr * m * shape;
      const x = c + Math.cos(ang) * r;
      const y = c + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(
      c - lr * 0.28,
      c - lr * 0.32,
      lr * 0.1,
      c,
      c,
      lr * 1.1,
    );
    g.addColorStop(0, layer.inner);
    g.addColorStop(1, layer.outer);
    ctx.globalAlpha = layer.alpha;
    ctx.fillStyle = g;
    ctx.fill();
  });
  ctx.globalAlpha = 1;
};

// One shared ~60fps clock ticks the playing orbs (idle orbs are static), so
// amplitude motion stays smooth with a single rAF loop instead of one per card.
// Each subscriber advances its OWN frame counter, so a newly-playing orb starts
// from its calm baseline instead of jumping to a shared clock's position.
const vizSubscribers = new Set<() => void>();
let vizRunning = false;
let vizLast = 0;

const vizLoop = (now: number) => {
  if (now - vizLast >= 16) {
    vizLast = now;
    vizSubscribers.forEach((fn) => fn());
  }
  if (vizSubscribers.size) {
    window.requestAnimationFrame(vizLoop);
  } else {
    vizRunning = false;
  }
};

export const subscribeViz = (fn: () => void) => {
  vizSubscribers.add(fn);
  if (!vizRunning) {
    vizRunning = true;
    window.requestAnimationFrame(vizLoop);
  }
  return () => {
    vizSubscribers.delete(fn);
  };
};
