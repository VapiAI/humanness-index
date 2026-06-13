'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { attachAudioAnalyser, releaseAudioAnalyser } from '../lib/audioLevel';
import { GAP_MS, MODEL_SAMPLE_CLIPS, PLAY_MS, SAMPLE_PHRASE } from '../data/battles';
import { trackSamplePlayed } from '../lib/analytics';
import { getSample } from '../lib/api';
import type {
  BattleSide,
  HeroBattle,
  RoundPhase,
  ScoredModel,
} from '../lib/types';

const NO_SIDES_PLAYED: Record<BattleSide, boolean> = {
  left: false,
  right: false,
};

/**
 * The arena's audio engine: plays real recorded clips (per-model samples and
 * the two-voice head-to-head sequence) with `speechSynthesis` / a synth tone
 * as last-resort fallbacks, mirroring the prototype. A monotonically
 * increasing "generation" token guards every async callback, so a stop or
 * restart cleanly aborts whatever sequence was in flight.
 */
export const useArenaAudio = () => {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [promptProgress, setPromptProgress] = useState(0);
  const [roundPhase, setRoundPhase] = useState<RoundPhase>('idle');
  const [playedSides, setPlayedSides] = useState(NO_SIDES_PLAYED);
  // Sides whose clip has *started* at least once — gates when voting unlocks
  // (the listener can vote as soon as both have begun, mid-playback).
  const [startedSides, setStartedSides] = useState(NO_SIDES_PLAYED);

  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const roundTimerRef = useRef<number | null>(null);
  const roundActiveRef = useRef(false);
  // Bumped on every play/stop; pending async callbacks bail if it changed.
  const playGenRef = useRef(0);
  // What kind of playback last started — lets sample-scoped stops (e.g. the
  // rankings click-away) leave battle-round audio alone.
  const playSourceRef = useRef<'sample' | 'battle' | null>(null);
  const speechVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  // Mirror of playedSides for callbacks (state updates are async).
  const playedSidesRef = useRef(NO_SIDES_PLAYED);
  const startedSidesRef = useRef(NO_SIDES_PLAYED);

  /** A side counts as heard once its clip has finished once; both → picks unlock. */
  const markSidePlayed = useCallback((side: BattleSide) => {
    playedSidesRef.current = { ...playedSidesRef.current, [side]: true };
    setPlayedSides(playedSidesRef.current);
    if (playedSidesRef.current.left && playedSidesRef.current.right) {
      roundActiveRef.current = false;
      setRoundPhase('ready');
    }
  }, []);

  /** Mark a side's playback as begun (voting unlocks once both have started). */
  const markSideStarted = useCallback((side: BattleSide) => {
    if (startedSidesRef.current[side]) return;
    startedSidesRef.current = { ...startedSidesRef.current, [side]: true };
    setStartedSides(startedSidesRef.current);
  }, []);

  const resetSides = useCallback(() => {
    playedSidesRef.current = NO_SIDES_PLAYED;
    startedSidesRef.current = NO_SIDES_PLAYED;
    setPlayedSides(NO_SIDES_PLAYED);
    setStartedSides(NO_SIDES_PLAYED);
  }, []);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return undefined;
    const loadVoices = () => {
      speechVoicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.cancel();
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  const playFallbackTone = useCallback((model: ScoredModel) => {
    if (!window.AudioContext) return;
    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    const now = context.currentTime;
    const base = 160 + (model.voiceProfile % 8) * 24;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    gain.connect(context.destination);
    [0, 1, 2].forEach((index) => {
      const osc = context.createOscillator();
      osc.type = index === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(base + index * 48, now);
      osc.connect(gain);
      osc.start(now + index * 0.06);
      osc.stop(now + 1.35);
    });
  }, []);

  const speak = useCallback(
    (model: ScoredModel) => {
      if (!('speechSynthesis' in window)) {
        playFallbackTone(model);
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(SAMPLE_PHRASE);
      const voiceOptions = speechVoicesRef.current.length
        ? speechVoicesRef.current
        : window.speechSynthesis.getVoices();
      if (voiceOptions.length) {
        utterance.voice = voiceOptions[model.voiceProfile % voiceOptions.length];
      }
      utterance.rate = 0.96; // phone-quality pacing
      utterance.pitch = 0.86 + (model.voiceProfile % 7) * 0.035;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    },
    [playFallbackTone],
  );

  const stopClip = useCallback(() => {
    const audio = audioElementRef.current;
    if (audio) {
      try {
        audio.pause();
      } catch {
        // ignore
      }
      audio.onended = null;
      audio.onerror = null;
      audioElementRef.current = null;
    }
    releaseAudioAnalyser();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  /** Play a real recorded clip; fall back to synthesized speech if the audio can't load. */
  const startClip = useCallback(
    (url: string | undefined, model: ScoredModel, onEnded?: () => void) => {
      stopClip();
      setPromptProgress(0);
      const gen = playGenRef.current;
      let done = false;
      const finish = () => {
        if (done || gen !== playGenRef.current) return; // superseded by a stop/restart
        done = true;
        onEnded?.();
      };
      if (url) {
        // crossOrigin must be set before src so the fetch is a CORS request,
        // letting the shared analyser read samples for the orb (the clip origin
        // sends Access-Control-Allow-Origin: *).
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.src = url;
        attachAudioAnalyser(audio);
        audio.ontimeupdate = () => {
          if (audio.duration) {
            setPromptProgress(Math.min(1, audio.currentTime / audio.duration));
          }
        };
        audio.onended = () => {
          setPromptProgress(1);
          finish();
        };
        audio.onerror = () => {
          setPromptProgress(1);
          speak(model);
          window.setTimeout(finish, PLAY_MS);
        };
        audioElementRef.current = audio;
        audio.play().catch(() => {
          setPromptProgress(1);
          speak(model);
          window.setTimeout(finish, PLAY_MS);
        });
        window.setTimeout(finish, 20000); // backstop in case 'ended' never fires
        return;
      }
      setPromptProgress(1);
      speak(model);
      window.setTimeout(finish, PLAY_MS);
    },
    [speak, stopClip],
  );

  // Each model's sample clip is pinned for the session: replaying a model
  // gives the same clip, not a fresh random draw on every click.
  const sampleUrlsRef = useRef<Record<string, string>>({});

  const playModelSample = useCallback(
    (model: ScoredModel) => {
      playGenRef.current += 1; // fresh playback token; invalidates pending callbacks
      const gen = playGenRef.current;
      playSourceRef.current = 'sample';
      setPlayingId(model.id);
      trackSamplePlayed(model.id);
      void (async () => {
        // The pinned clip, else a random one from the API (static fallback).
        let url = sampleUrlsRef.current[model.id] ?? MODEL_SAMPLE_CLIPS[model.id];
        if (!sampleUrlsRef.current[model.id]) {
          try {
            url = (await getSample(model.id)).audioUrl;
          } catch {
            // Keep the fallback clip.
          }
        }
        if (gen !== playGenRef.current) return; // stopped while fetching
        if (url) sampleUrlsRef.current[model.id] = url;
        startClip(url, model, () => setPlayingId(null));
      })();
    },
    [startClip],
  );

  const stopPlayback = useCallback(() => {
    playGenRef.current += 1; // invalidate pending playback callbacks
    playSourceRef.current = null;
    if (roundTimerRef.current) window.clearTimeout(roundTimerRef.current);
    stopClip();
    setPlayingId(null);
  }, [stopClip]);

  /** Stop playback only if a standalone model sample is playing — battle audio is untouched. */
  const stopSamplePlayback = useCallback(() => {
    if (playSourceRef.current !== 'sample') return;
    stopPlayback();
  }, [stopPlayback]);

  const togglePlay = useCallback(
    (model: ScoredModel) => {
      if (playingId === model.id) stopPlayback();
      else playModelSample(model);
    },
    [playingId, playModelSample, stopPlayback],
  );

  /**
   * The head-to-head sequence: Voice A plays its real clip, marks done, then
   * Voice B does the same; then the picks unlock (`roundPhase: 'ready'`).
   */
  const playRound = useCallback(
    (battle: HeroBattle, leftModel: ScoredModel, rightModel: ScoredModel) => {
      if (roundActiveRef.current) return; // guard against double-start
      roundActiveRef.current = true;
      playGenRef.current += 1;
      playSourceRef.current = 'battle';
      const gen = playGenRef.current; // this round's token; a stop/restart bumps it
      if (roundTimerRef.current) window.clearTimeout(roundTimerRef.current);
      resetSides();
      setRoundPhase('playing');
      setPlayingId(leftModel.id);
      markSideStarted('left');
      startClip(battle.leftAudio, leftModel, () => {
        if (gen !== playGenRef.current) return; // stopped — don't advance to voice B
        setPlayingId(null);
        markSidePlayed('left');
        roundTimerRef.current = window.setTimeout(() => {
          if (gen !== playGenRef.current) return;
          setPlayingId(rightModel.id);
          markSideStarted('right');
          startClip(battle.rightAudio, rightModel, () => {
            if (gen !== playGenRef.current) return;
            setPlayingId(null);
            markSidePlayed('right');
          });
        }, GAP_MS);
      });
    },
    [markSidePlayed, markSideStarted, resetSides, startClip],
  );

  /**
   * Manual playback of one side — lets the listener click back and forth
   * between the voices (and re-listen during the pick phase). Interrupts the
   * auto-sequence; toggling the side that's already playing stops it. A side
   * still only counts as heard once its clip finishes. From idle (keyboard
   * fast mode) it also opens the round in manual mode — no auto-advance.
   */
  const toggleBattleSide = useCallback(
    (side: BattleSide, model: ScoredModel, audioUrl: string) => {
      if (playingId === model.id) {
        stopPlayback();
        return;
      }
      roundActiveRef.current = false; // cancel any pending auto-advance
      playGenRef.current += 1;
      playSourceRef.current = 'battle';
      if (roundTimerRef.current) window.clearTimeout(roundTimerRef.current);
      setRoundPhase((phase) => (phase === 'idle' ? 'playing' : phase));
      setPlayingId(model.id);
      markSideStarted(side);
      startClip(audioUrl, model, () => {
        setPlayingId(null);
        markSidePlayed(side);
      });
    },
    [markSidePlayed, markSideStarted, playingId, startClip, stopPlayback],
  );

  /** Reset for the next pair without restarting playback. */
  const resetRound = useCallback(() => {
    roundActiveRef.current = false;
    if (roundTimerRef.current) window.clearTimeout(roundTimerRef.current);
    stopClip();
    setRoundPhase('idle');
    resetSides();
  }, [resetSides, stopClip]);

  // Don't leave audio playing after navigating away.
  useEffect(() => stopClip, [stopClip]);

  return {
    playingId,
    promptProgress,
    roundPhase,
    playedSides,
    /** True once both voices have begun playing — gates voting. */
    bothStarted: startedSides.left && startedSides.right,
    playModelSample,
    togglePlay,
    stopPlayback,
    stopSamplePlayback,
    playRound,
    toggleBattleSide,
    resetRound,
  };
};
