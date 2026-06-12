'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { vizForModel } from '../lib/burstFills';
import type { Palette, ScoredModel } from '../lib/types';
import { subscribeViz, voiceFingerprint, voiceStyle } from '../lib/voiceViz';

const VIZ_SIZE = 132;

type VoiceVizProps = {
  model: ScoredModel;
  playing: boolean;
  size?: number;
  animate?: boolean;
  palette?: Palette;
};

/** A model's animated canvas "voice fingerprint" visualization. */
export const VoiceViz = ({
  playing,
  model,
  size = VIZ_SIZE,
  animate = true,
  palette: paletteOverride,
}: VoiceVizProps) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const tRef = useRef(0);
  const drawRef = useRef<(step: number) => void>(() => {});
  const [onScreen, setOnScreen] = useState(true);
  // Key the memos on the stable identity fields so vote-driven model updates
  // don't restart the canvas.
  const { provider, voiceProfile } = model;
  const { palette: basePalette } = useMemo(
    () => voiceStyle({ provider, voiceProfile }),
    [provider, voiceProfile],
  );
  const palette = paletteOverride ?? basePalette;
  const viz = useMemo(() => vizForModel({ provider }), [provider]);
  const fingerprint = useMemo(() => voiceFingerprint({ voiceProfile }), [voiceProfile]);

  // Canvas setup + one static frame; re-runs only when the art itself changes.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawRef.current = (step: number) => {
      tRef.current += step;
      ctx.clearRect(0, 0, size, size);
      try {
        viz.draw(ctx, tRef.current, size, palette, fingerprint);
      } catch {
        // Skip a bad frame rather than crash.
      }
    };
    drawRef.current(0);
  }, [viz, palette, fingerprint, size]);

  // Visibility tracking only matters while animating; static canvases skip
  // the observer (and the redraws its flips used to trigger during scroll).
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
    if (!animate || !onScreen) return undefined;
    const step = playing ? 1 : 0.28; // subtle drift at rest, full speed while playing
    return subscribeViz(() => drawRef.current(step));
  }, [playing, animate, onScreen]);

  return (
    <span className="voice-viz" aria-hidden="true">
      <canvas ref={ref} className="voice-canvas" style={{ width: size }} />
    </span>
  );
};
