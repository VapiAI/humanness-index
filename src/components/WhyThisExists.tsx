/** Short manifesto placed above the CTA band: why the benchmark exists. */
export const WhyThisExists = () => (
  <section className="why-exists" aria-label="Why this exists">
    <div className="why-exists-inner">
      <p className="why-exists-eyebrow">Why this exists</p>
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
