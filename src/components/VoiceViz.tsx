'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { sampleAudioLevel } from '../lib/audioLevel';
import type { Palette, ScoredModel } from '../lib/types';
import { drawOrb, subscribeViz, voiceFingerprint, voiceStyle } from '../lib/voiceViz';

const VIZ_SIZE = 132;

type VoiceVizProps = {
  model: ScoredModel;
  playing: boolean;
  size?: number;
  animate?: boolean;
  palette?: Palette;
};

/** A model's gradient "voice orb" — calm at rest, pulsing with the live clip amplitude. */
export const VoiceViz = ({
  playing,
  model,
  size = VIZ_SIZE,
  animate = true,
  palette: paletteOverride,
}: VoiceVizProps) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  // Smoothed amplitude (fast attack, gentle release) and the morph clock value.
  const levelRef = useRef(0);
  const frameRef = useRef(0);
  const [onScreen, setOnScreen] = useState(true);

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
    drawOrb(ctx, frameRef.current, size, palette, 0, fingerprint);
  }, [palette, fingerprint, size]);

  // Visibility tracking only matters while animating; static orbs skip it.
  useEffect(() => {
    const canvas = ref.current;
    if (!animate || !canvas || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => setOnScreen(entries[0]?.isIntersecting ?? true),
      { rootMargin: '120px' },
    );
    io.observe(canvas);
    return () => io.disconnect();
  }, [animate]);

  useEffect(() => {
    const ctx = ctxRef.current;
    // Not animating: settle to a calm frame and stop.
    if (!animate || !onScreen) {
      if (ctx) {
        levelRef.current = 0;
        ctx.clearRect(0, 0, size, size);
        drawOrb(ctx, frameRef.current, size, palette, 0, fingerprint);
      }
      return undefined;
    }
    return subscribeViz((frame) => {
      if (!ctx) return;
      const target = playing ? sampleAudioLevel() : 0;
      const cur = levelRef.current;
      // Fast attack, gentle release: the orb pops on syllables, settles smoothly.
      levelRef.current = cur + (target - cur) * (target > cur ? 0.4 : 0.12);
      frameRef.current = frame;
      ctx.clearRect(0, 0, size, size);
      drawOrb(ctx, frame, size, palette, levelRef.current, fingerprint);
    });
  }, [animate, onScreen, playing, palette, fingerprint, size]);

  return (
    <span className="voice-viz" aria-hidden="true">
      <canvas ref={ref} className="voice-canvas" style={{ width: size }} />
    </span>
  );
};
