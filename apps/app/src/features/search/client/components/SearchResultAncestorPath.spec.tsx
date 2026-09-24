import { render, screen } from '@testing-library/react';

import { SearchResultAncestorPath } from './SearchResultAncestorPath';

// ancestors: Projects / GROWI / GROWI.cloud / team / notes, page name: memo
const DEEP_PATH = '/Projects/GROWI/GROWI.cloud/team/notes/memo';

describe('SearchResultAncestorPath', () => {
  describe('tooltip (full path)', () => {
    it('exposes the full path including the page name as the container title for a deep/truncated path', () => {
      const { container } = render(
        <SearchResultAncestorPath path={DEEP_PATH} />,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.getAttribute('title')).toBe(DEEP_PATH);
    });

    it('exposes the full path including the page name as the container title for a short/untruncated path', () => {
      const { container } = render(<SearchResultAncestorPath path="/A/B" />);

      const root = container.firstElementChild as HTMLElement;
      expect(root.getAttribute('title')).toBe('/A/B');
    });
  });

  describe('ellipsis (Requirement 5.2)', () => {
    it('renders the ellipsis as an independent, non-link text node', () => {
      render(<SearchResultAncestorPath path={DEEP_PATH} />);

      const ellipsis = screen.getByText('…');
      expect(ellipsis.closest('a')).toBeNull();
      expect(ellipsis.tagName).not.toBe('A');
    });
  });

  describe('surviving ancestor segments (Requirement 5.1)', () => {
    it('renders a surviving ancestor segment as a link with the correct href', () => {
      render(<SearchResultAncestorPath path={DEEP_PATH} />);

      // first ancestor
      const firstLink = screen.getByRole('link', { name: 'Projects' });
      expect(firstLink).toHaveAttribute('href', '/Projects');

      // parent ancestor (directly before the page name)
      const parentLink = screen.getByRole('link', { name: 'notes' });
      expect(parentLink).toHaveAttribute(
        'href',
        '/Projects/GROWI/GROWI.cloud/team/notes',
      );
    });

    it('renders every ancestor as a link when the path is short (no truncation)', () => {
      render(<SearchResultAncestorPath path="/A/B" />);

      expect(screen.getByRole('link', { name: 'A' })).toHaveAttribute(
        'href',
        '/A',
      );
      expect(screen.queryByText('…')).toBeNull();
    });
  });

  describe('search keyword highlight (Requirement 6.1, 6.2)', () => {
    it('reflects <em> highlight markup on a surviving segment', () => {
      const { container } = render(
        <SearchResultAncestorPath
          path="/A/B/C/D"
          highlightedPath="/A/B/<em>C</em>/D"
        />,
      );

      // RTL's getByText cannot match text split by an inline tag, so inspect the
      // rendered HTML directly.
      const em = container.querySelector('em');
      expect(em).not.toBeNull();
      expect(em?.textContent).toBe('C');
    });
  });

  describe('root icon and separators (Requirement 2.2: same as PagePathHierarchicalLink)', () => {
    it('renders a "/" after the home icon even with zero ancestors, as part of the top-page link', () => {
      const { container } = render(<SearchResultAncestorPath path="/A" />);

      const homeLink = screen.getByText('home').closest('a');
      expect(homeLink).toHaveAttribute('href', '/');
      expect(homeLink?.textContent).toBe('home/');
      expect(container.querySelectorAll('a')).toHaveLength(1);
    });

    it('separates the root icon and every ancestor with exactly one "/"', () => {
      const { container } = render(<SearchResultAncestorPath path="/A/B/C" />);

      expect(container.textContent).toBe('home/A/B');
    });

    it('renders the trash icon followed by a "/" linking to the top page', () => {
      render(<SearchResultAncestorPath path="/trash" />);

      expect(screen.getByText('delete').closest('a')).toHaveAttribute(
        'href',
        '/trash',
      );
      expect(screen.queryByText('home')).toBeNull();
      expect(screen.getByText('/').closest('a')).toHaveAttribute('href', '/');
    });

    it('renders the trash root before the ancestors of a trashed page', () => {
      const { container } = render(
        <SearchResultAncestorPath path="/trash/foo/bar" />,
      );

      expect(container.textContent).toBe('delete/trash/foo');
    });
  });
});
