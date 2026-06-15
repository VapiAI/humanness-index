import { RevealGroup } from './Reveal';

/** Short manifesto placed above the CTA band: why the benchmark exists. */
export const WhyThisExists = () => (
  <section className="why-exists" aria-labelledby="why-exists-heading">
    <RevealGroup as="div" className="why-exists-inner">
      <h2 className="why-exists-eyebrow" id="why-exists-heading">
        Why this exists
      </h2>
      <p className="why-exists-body">
        Picking a TTS model for a voice agent comes down to one thing: does it
        sound human enough that people forget they&apos;re talking to software? You
        can&apos;t get that from demos or vendor claims. So we made it measurable and
        took the call out of our own hands: one voice cloned onto every model, played
        blind with no names attached, scored against a real human by the people who
        hear it.
      </p>
    </RevealGroup>
  </section>
);
