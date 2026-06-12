/** Server-rendered JSON-LD script tag (escaped against </script> injection). */
export const JsonLd = ({ data }: { data: object }) => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{
      __html: JSON.stringify(data).replaceAll('<', '\\u003c'),
    }}
  />
);
