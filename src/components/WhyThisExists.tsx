/** Short manifesto placed above the CTA band: why the benchmark exists. */
export const WhyThisExists = () => (
  <section className="why-exists" aria-labelledby="why-exists-heading">
    <div className="why-exists-inner">
      <h2 className="why-exists-eyebrow" id="why-exists-heading">
        Why this exists
      </h2>
      <p className="why-exists-body">
        Picking a TTS model for a voice agent comes down to one thing: does it
        sound human enough that people forget they&apos;re talking to software?
        That&apos;s hard to judge from demos and vendor claims, so we made it
        measurable. One voice on every model, judged blind against a real human,
        scored on humanness and latency.
      </p>
    </div>
  </section>
);
