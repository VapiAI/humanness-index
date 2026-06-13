/**
 * Voice-visualization engine: the brand palettes, the per-voice fingerprint
 * that tunes the animation, the amplitude-reactive gradient orb every model
 * renders, and the shared ~60fps clock that drives the playing orbs.
 */
import type { ArenaRow, Palette, VoiceFingerprint } from './types';

const TAU = Math.PI * 2;

/**
 * Each palette is a TIGHT single-hue ramp (brand color → lighter → deeper).
 * Keeping all three stops in one hue means the gradients stay vibrant instead
 * of muddying through the desaturated grey you get blending distant hues.
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

// Each brand gets ONE signature color ramp, so all of a provider's models read
// as the same family. (The blind battle cards override this with the
// teal-vs-sunset A/B story — that's intentional.)
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
) => {
  const c = size / 2;
  const seed = fp.p ?? 0;
  const sp = fp.speed ?? 1;
  const lvl = Math.max(0, Math.min(1, level));
  const breathe = 1 + 0.018 * Math.sin(frame * 0.04 + seed);
  const R = size * 0.27 * breathe * (1 + 0.12 * lvl);

  // Outer glow halo — blooms with amplitude.
  const haloR = R * (1.55 + 0.6 * lvl);
  const halo = ctx.createRadialGradient(c, c, R * 0.5, c, c, haloR);
  halo.addColorStop(0, hexA(pal.from, 0.16 + 0.34 * lvl));
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
    const wob = layer.wob * (1 + 1.5 * lvl);
    const spin = frame * 0.016 * (idx + 1) * sp + seed + idx;
    ctx.beginPath();
    for (let i = 0; i <= 72; i += 1) {
      const ang = (i / 72) * TAU;
      const m =
        1 +
        wob * Math.sin(ang * layer.k + spin) +
        wob * 0.5 * Math.sin(ang * (layer.k + 2) - spin * 0.7);
      const r = lr * m;
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

  // Soft top-left sheen, clipped to the core for a 3D read.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R * 0.98, 0, TAU);
  ctx.clip();
  const sheen = ctx.createRadialGradient(
    c - R * 0.32,
    c - R * 0.4,
    0,
    c - R * 0.32,
    c - R * 0.4,
    R * 1.1,
  );
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.38)');
  sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(c - R, c - R, R * 2, R * 2);
  ctx.restore();
};

// One shared ~60fps clock drives the playing orbs (idle orbs are static), so
// amplitude motion stays smooth with a single rAF loop instead of one per card.
const vizSubscribers = new Set<(frame: number) => void>();
let vizRunning = false;
let vizLast = 0;
let vizFrame = 0;

const vizLoop = (now: number) => {
  if (now - vizLast >= 16) {
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
