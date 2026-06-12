import type { FaqEntry } from '../../catalog';

/** Registry FAQ entries as plain crawlable HTML (no FAQPage JSON-LD). */
export const FaqBlock = ({ faq }: { faq: FaqEntry[] }) => {
  if (faq.length === 0) return null;
  return (
    <section className="detail-section detail-faq" aria-label="Frequently asked questions">
      <h2>Frequently asked questions</h2>
      <dl>
        {faq.map((entry) => (
          <div key={entry.question} className="detail-faq-item">
            <dt>{entry.question}</dt>
            <dd>{entry.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
};
