'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { useReveal } from '../hooks/useReveal';
import { sampleAudioLevel } from '../lib/audioLevel';
import type { Palette, ScoredModel } from '../lib/types';
import { drawOrb, subscribeViz, voiceFingerprint, voiceStyle } from '../lib/voiceViz';

const VIZ_SIZE = 132;

type VoiceVizProps = {
  // Only the brand/seed fields drive the orb, so a blind battle card can pass a
  // fixed per-side fingerprint (no real identity) instead of a full model.
  model: Pick<ScoredModel, 'provider' | 'voiceProfile'>;
  playing: boolean;
  size?: number;
  animate?: boolean;
  palette?: Palette;
  /** 0 = round/organic, 1 = rounded-square. Bound to Humanness on cards/detail. */
  squareness?: number;
  /** Stagger (ms) for the one-time fade/scale entrance (card grids cascade). */
  enterDelay?: number;
};

/** A model's gradient "voice orb" — calm at rest, pulsing with the live clip amplitude. */
export const VoiceViz = ({
  playing,
  model,
  size = VIZ_SIZE,
  animate = true,
  palette: paletteOverride,
  squareness = 0,
  enterDelay = 0,
}: VoiceVizProps) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // One-time entrance: the orb fades + scales into place on first reveal, then
  // the amplitude-reactive loop above takes over untouched.
  const { ref: enterRef, inView: entered } = useReveal<HTMLSpanElement>({
    threshold: 0.15,
    rootMargin: '0px 0px -8% 0px',
  });
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  // Smoothed amplitude (fast attack, gentle release) and the morph clock value.
  const levelRef = useRef(0);
  const frameRef = useRef(0);
  // Read inside the rAF loop without re-subscribing, so stopping doesn't tear
  // the loop down mid-fade.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const [onScreen, setOnScreen] = useState(true);
  // Stays true through the release tail after playback stops, so the amplitude
  // eases out instead of snapping to calm the instant audio stops.
  const [active, setActive] = useState(false);

  // Key the memos on stable identity fields so vote-driven updates don't restart it.
  const { provider, voiceProfile } = model;
  const { palette: basePalette } = useMemo(
    () => voiceStyle({ provider, voiceProfile }),
    [provider, voiceProfile],
  );
  const palette = paletteOverride ?? basePalette;
  const fingerprint = useMemo(() => voiceFingerprint({ voiceProfile }), [voiceProfile]);

  // Canvas setup + one calm frame; re-runs only when the art itself changes.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxRef.current = ctx;
    ctx.clearRect(0, 0, size, size);
    drawOrb(ctx, frameRef.current, size, palette, levelRef.current, fingerprint, squareness);
  }, [palette, fingerprint, size, squareness]);

  // Begin animating when playback starts; the loop keeps running through the
  // fade-out afterwards and ends itself once the level has decayed.
  useEffect(() => {
    if (playing && animate) setActive(true);
  }, [playing, animate]);

  // Visibility tracking only matters while animating; static orbs skip it.
  useEffect(() => {
    const canvas = ref.current;
    if (!active || !canvas || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => setOnScreen(entries[0]?.isIntersecting ?? true),
      { rootMargin: '120px' },
    );
    io.observe(canvas);
    return () => io.disconnect();
  }, [active]);

  useEffect(() => {
    const ctx = ctxRef.current;
    // Idle: settle to calm (level 0) but DON'T reset the morph clock — redraw at
    // the CURRENT frame so the blob's phase doesn't snap when playback stops.
    // The per-orb frame counter persists, so the next play resumes from here.
    if (!active || !onScreen) {
      if (ctx) {
        levelRef.current = 0;
        ctx.clearRect(0, 0, size, size);
        drawOrb(ctx, frameRef.current, size, palette, 0, fingerprint, squareness);
      }
      return undefined;
    }
    return subscribeViz(() => {
      if (!ctx) return;
      const target = playingRef.current ? sampleAudioLevel() : 0;
      const cur = levelRef.current;
      // Fast attack so the orb rises with each syllable; slower release so it
      // rides the speech envelope smoothly instead of flickering in the gaps.
      levelRef.current = cur + (target - cur) * (target > cur ? 0.45 : 0.12);
      frameRef.current += 1;
      ctx.clearRect(0, 0, size, size);
      drawOrb(ctx, frameRef.current, size, palette, levelRef.current, fingerprint, squareness);
      // Once stopped and faded out, end the release tail and settle calm.
      if (!playingRef.current && levelRef.current < 0.01) {
        levelRef.current = 0;
        setActive(false);
      }
    });
  }, [active, onScreen, palette, fingerprint, size, squareness]);

  return (
    <span
      ref={enterRef}
      className={`voice-viz viz-enter${entered ? ' is-in' : ''}`}
      style={
        enterDelay
          ? ({ '--viz-enter-delay': `${enterDelay}ms` } as CSSProperties)
          : undefined
      }
      aria-hidden="true"
    >
      <canvas ref={ref} className="voice-canvas" style={{ width: size }} />
    </span>
  );
};
