import Link from 'next/link';

import type { BreadcrumbItem } from '../../lib/detail';

/** Visible breadcrumb trail; the matching JSON-LD ships separately. */
export const Breadcrumbs = ({ items }: { items: BreadcrumbItem[] }) => (
  <nav className="detail-breadcrumbs" aria-label="Breadcrumb">
    <ol>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <li key={item.name} aria-current={isLast ? 'page' : undefined}>
            {item.path && !isLast ? (
              <Link href={item.path}>{item.name}</Link>
            ) : (
              <span>{item.name}</span>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);
