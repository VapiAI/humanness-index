import type { ReactNode } from 'react';

import { RevealGroup } from './Reveal';

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
    <RevealGroup as="div" className="pieces-inner">
      <div className="section-heading">
        <div>
          <p className="eyebrow">What we Listen for</p>
          <h2>What makes a voice sound human?</h2>
        </div>
        <p className="pieces-lead">
          Humanness doesn&apos;t break down into features. You either believe
          there&apos;s a person on the other end, or you don&apos;t. When that belief
          breaks, it&apos;s usually because of one of&nbsp;these.
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
        <h3 className="section-callout-title">Why trust this benchmark?</h3>
        <p className="section-callout-body">
          Any model can sound good on its own demo voice. The real test is how it
          handles your use case. We clone one voice across every model so the comparison
          is fair. Models that can&apos;t clone a voice can&apos;t be tested fairly, so
          they&apos;re not listed.
        </p>
      </div>
    </RevealGroup>
  </section>
);
