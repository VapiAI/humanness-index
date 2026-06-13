'use client';

import { useEffect, useRef, useState } from 'react';

import { trackSamplePlayed } from '../../lib/analytics';
import { getSample } from '../../lib/api';
import type { ScoredModel } from '../../lib/types';
import { RankCardArt } from '../RankCard';

const IDLE_CAPTION =
  'A real arena clip: a cloned source voice reading a customer support prompt at phone quality.';

type SamplePlayerProps = {
  /** Snapshot row for the model (drives the viz fingerprint + labels). */
  model: ScoredModel;
  /** Deterministic hosted clip precomputed server-side (offline fallback). */
  fallbackUrl: string;
};

/**
 * Lightweight sample island for detail pages: the index page's art well
 * (VoiceViz + Listen pill) wired to GET /api/sample, with the
 * precomputed static clip as fallback. Deliberately NOT the battle audio
 * engine; one clip at a time is all this page needs. The RSC renders a
 * plain <audio> inside <noscript> so audio stays reachable without JS.
 */
export const SamplePlayer = ({ model, fallbackUrl }: SamplePlayerProps) => {
  const [playing, setPlaying] = useState(false);
  const [caption, setCaption] = useState(IDLE_CAPTION);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Bumped on every play/stop; pending async callbacks bail if it changed.
  const playGenRef = useRef(0);

  const stopPlayback = () => {
    playGenRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
  };

  const handleToggle = () => {
    if (playing) {
      stopPlayback();
      return;
    }
    playGenRef.current += 1;
    const gen = playGenRef.current;
    setPlaying(true);
    trackSamplePlayed(model.id);
    void (async () => {
      let url = fallbackUrl;
      let prompt: string | null = null;
      try {
        const sample = await getSample(model.id);
        url = sample.audioUrl;
        prompt = sample.prompt;
      } catch {
        // Keep the deterministic fallback clip.
      }
      if (gen !== playGenRef.current) return; // stopped while fetching
      if (prompt) setCaption(`\u201c${prompt}\u201d`);
      const audio = new Audio(url);
      audioRef.current = audio;
      const finish = () => {
        if (gen !== playGenRef.current) return;
        setPlaying(false);
      };
      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
    })();
  };

  // Don't leave audio playing after navigating away.
  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  return (
    <div className="detail-sample">
      <RankCardArt model={model} playing={playing} animate={playing} onPlay={handleToggle} />
      <p className="detail-sample-caption">{caption}</p>
      <noscript>
        <audio controls preload="none" src={fallbackUrl} />
      </noscript>
    </div>
  );
};
