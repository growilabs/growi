// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';

import { PageSources } from './PageSources';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// next/link reaches for the Pages-Router context (prefetch); render a plain
// anchor so we can assert the href contract directly.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The ai-elements Sources wrap a Radix Collapsible that unmounts its content
// while collapsed; render children eagerly so the source links are queryable.
vi.mock('~/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe('PageSources', () => {
  it('renders each source as an in-app /{pageId} permalink, not the page path', () => {
    render(
      <PageSources
        sources={[
          { pageId: 'p1', path: '/Sandbox/Alpha' },
          { pageId: 'p2', path: '/Docs/Beta' },
        ]}
      />,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    // The href is the pageId permalink — never the (possibly stale / unescaped)
    // page path, and always same-origin so it cannot become an external link.
    expect(links[0]).toHaveAttribute('href', '/p1');
    expect(links[1]).toHaveAttribute('href', '/p2');
    // The human-readable path is shown as the label.
    expect(screen.getByText('/Sandbox/Alpha')).toBeInTheDocument();
    expect(screen.getByText('/Docs/Beta')).toBeInTheDocument();
  });

  it('renders nothing when there are no sources', () => {
    const { container } = render(<PageSources sources={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
