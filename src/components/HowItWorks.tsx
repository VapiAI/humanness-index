import { RevealGroup } from './Reveal';

/** Three-step explainer strip directly under the hero: the biggest confusion-killer. */
const STEPS = [
  {
    n: 1,
    title: 'Same voice, every model',
    desc: "We clone one conversational voice onto every model, so you're judging the model, not its demo reel.",
  },
  {
    n: 2,
    title: 'You listen blind',
    desc: 'Two voices, same line, no labels. Pick the one that sounds more human.',
  },
  {
    n: 3,
    title: 'A real human sets the bar',
    desc: 'Votes are converted to an Elo score, with a real human at 100. The higher the score, the more human the model sounds.',
  },
];

export const HowItWorks = () => (
  <section className="how-it-works" aria-labelledby="how-it-works-heading">
    {/* Visually hidden, but kept in the DOM as the section's <h2> so the
        heading hierarchy (h2 section -> h3 steps) stays intact for SEO and
        screen readers. The visible title was removed by request. */}
    <h2 className="sr-only" id="how-it-works-heading">
      How it works
    </h2>
    <RevealGroup as="ol" className="hiw-grid">
      {STEPS.map((step) => (
        <li className="hiw-step" key={step.n}>
          <span className="hiw-ghost" aria-hidden="true">
            {step.n}
          </span>
          <div className="hiw-body">
            <p className="hiw-eyebrow">Step {step.n}</p>
            <h3 className="hiw-title">{step.title}</h3>
            <p className="hiw-desc">{step.desc}</p>
          </div>
        </li>
      ))}
    </RevealGroup>
  </section>
);
