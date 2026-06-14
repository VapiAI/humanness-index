/**
 * A shared Web Audio analyser so the voice orb can pulse with the live
 * amplitude of whatever clip is playing.
 *
 * One AudioContext + AnalyserNode is created lazily on the first play (a user
 * gesture, so autoplay policy is satisfied). Each <audio> element is routed
 * through the analyser exactly once. The element must be CORS-clean
 * (crossOrigin set + the clip origin returns Access-Control-Allow-Origin) or
 * Web Audio would replace the output with silence; every call is wrapped so
 * any failure simply skips the wiring and leaves normal playback untouched —
 * the orb just stays calm.
 */

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let timeData: Uint8Array<ArrayBuffer> | null = null;
let currentSource: MediaElementAudioSourceNode | null = null;
// createMediaElementSource may be called only once per element, ever.
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

const ensureGraph = (): boolean => {
  if (audioCtx && analyser && timeData) return true;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return false;
    audioCtx = new Ctor();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    analyser.connect(audioCtx.destination);
    timeData = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    return true;
  } catch {
    audioCtx = null;
    analyser = null;
    timeData = null;
    return false;
  }
};

/** Route a playing element through the analyser (no-op on any failure). */
export const attachAudioAnalyser = (el: HTMLAudioElement): void => {
  if (!ensureGraph() || !audioCtx || !analyser) return;
  try {
    let source = sources.get(el);
    if (!source) {
      source = audioCtx.createMediaElementSource(el);
      sources.set(el, source);
    }
    currentSource?.disconnect();
    source.connect(analyser);
    currentSource = source;
    if (audioCtx.state === 'suspended') void audioCtx.resume();
  } catch {
    // Leave playback alone; the orb falls back to its calm state.
  }
};

/** Drop the current source from the analyser when playback stops. */
export const releaseAudioAnalyser = (): void => {
  try {
    currentSource?.disconnect();
  } catch {
    // ignore
  }
  currentSource = null;
};

/**
 * Smoothed RMS amplitude (0..1) of whatever is currently routed, else 0.
 * Gained up so conversational speech reaches a lively range.
 */
export const sampleAudioLevel = (): number => {
  if (!analyser || !timeData) return 0;
  analyser.getByteTimeDomainData(timeData);
  let sum = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const v = (timeData[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / timeData.length);
  // Conversational speech RMS sits low (~0.04) with brief peaks, so a flat gain
  // barely moves the orb. Gain it up and apply a soft curve (sqrt-ish) so normal
  // speech fills a lively 0..1 range and the orb tracks each syllable.
  return Math.pow(Math.min(1, rms * 3), 0.6);
};
