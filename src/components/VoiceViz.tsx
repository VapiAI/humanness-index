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
    drawOrb(ctx, frameRef.current, size, palette, levelRef.current, fingerprint);
  }, [palette, fingerprint, size]);

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
    // Idle: reset to the calm baseline (frame 0) and stop.
    if (!active || !onScreen) {
      if (ctx) {
        levelRef.current = 0;
        frameRef.current = 0;
        ctx.clearRect(0, 0, size, size);
        drawOrb(ctx, 0, size, palette, 0, fingerprint);
      }
      return undefined;
    }
    return subscribeViz(() => {
      if (!ctx) return;
      const target = playingRef.current ? sampleAudioLevel() : 0;
      const cur = levelRef.current;
      // Gentle attack on start, slower release on stop — both ease smoothly.
      levelRef.current = cur + (target - cur) * (target > cur ? 0.3 : 0.1);
      frameRef.current += 1;
      ctx.clearRect(0, 0, size, size);
      drawOrb(ctx, frameRef.current, size, palette, levelRef.current, fingerprint);
      // Once stopped and faded out, end the release tail and settle calm.
      if (!playingRef.current && levelRef.current < 0.01) {
        levelRef.current = 0;
        setActive(false);
      }
    });
  }, [active, onScreen, palette, fingerprint, size]);

  return (
    <span className="voice-viz" aria-hidden="true">
      <canvas ref={ref} className="voice-canvas" style={{ width: size }} />
    </span>
  );
};
