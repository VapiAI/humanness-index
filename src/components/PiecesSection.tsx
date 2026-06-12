import type { ReactNode } from 'react';

const PIECES: Array<{ title: string; body: ReactNode }> = [
  {
    title: 'Expressiveness',
    body: (
      <>
        Emotion and emphasis. Stressing the right words, sounding like it means what it
        says instead of reading text&nbsp;aloud.
      </>
    ),
  },
  {
    title: 'Tone & prosody',
    body: (
      <>
        The intonation, rhythm, and melody of speech. The natural rise and fall of how
        people actually&nbsp;talk.
      </>
    ),
  },
  {
    title: 'Artifacts',
    body: (
      <>
        The little human sounds: breaths, stutters, natural pauses. A voice with none of
        them sounds too clean to be&nbsp;real.
      </>
    ),
  },
  {
    title: 'Latency',
    body: (
      <>
        How quickly a voice starts to respond. Once a reply lags past a beat, the
        conversation stops feeling&nbsp;live.
      </>
    ),
  },
];

/** The full-bleed dark "what we listen for" band between Top Models and the rankings. */
export const PiecesSection = () => (
  <section
    className="pieces-section"
    aria-label="What makes a voice human"
    data-nav-theme="dark"
  >
    <div className="band-rails" aria-hidden="true" />
    <div className="pieces-inner">
      <div className="section-heading">
        <div>
          <p className="eyebrow">What we Listen for</p>
          <h2>What makes a human voice</h2>
        </div>
        <p className="pieces-lead">
          Listen to a synthetic voice and you can usually name what gave it away. These
          four tells come up the most. Nobody can fully define that feeling, so we play
          voices blind and let people judge. Both sides of every battle speak with the
          same cloned source voice, so votes compare the models, not the voices. Every
          score on this page comes from those&nbsp;votes.
        </p>
      </div>
      <div className="pieces-grid">
        {PIECES.map((piece) => (
          <article className="piece-card" key={piece.title}>
            <h3>{piece.title}</h3>
            <p>{piece.body}</p>
          </article>
        ))}
      </div>
    </div>
  </section>
);
