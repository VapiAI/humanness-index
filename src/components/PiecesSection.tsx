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
          Humanness isn&apos;t a checklist. It&apos;s whether the whole thing convinces you
          there&apos;s a person on the other end, which is why we test it blind instead of
          scoring features. Still, when a voice gives itself away, it&apos;s usually one
          of&nbsp;these.
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
      <div className="pieces-callout section-callout section-callout-dark">
        <h3 className="section-callout-title">
          Why we only look at models that support cloning.
        </h3>
        <p className="section-callout-body">
          A model can sound human on its own demo voice and robotic on yours. Comparing
          vendors&apos; hand-picked clips is apples to oranges. So we clone the same
          conversational voice onto every model and compare only that. Models that
          can&apos;t clone a voice can&apos;t be tested fairly, so they&apos;re not listed.
        </p>
      </div>
    </div>
  </section>
);
