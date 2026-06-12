import type { CopyBlock } from '../../catalog';

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Registry copy blocks (Background / At a glance / ...) as the page body. */
export const CopyBlocks = ({ blocks }: { blocks: CopyBlock[] }) => (
  <section className="detail-section detail-copy">
    {blocks.map((block) => (
      <article key={block.heading} className="detail-copy-block">
        <h2>{block.heading}</h2>
        {block.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 48)}>{paragraph}</p>
        ))}
        {block.sourceUrls && block.sourceUrls.length > 0 && (
          <p className="detail-copy-sources">
            {'Sources: '}
            {block.sourceUrls.map((url, index) => (
              <span key={url}>
                {index > 0 && ', '}
                <a href={url} rel="noopener noreferrer" target="_blank">
                  {hostnameOf(url)}
                </a>
              </span>
            ))}
          </p>
        )}
      </article>
    ))}
  </section>
);
