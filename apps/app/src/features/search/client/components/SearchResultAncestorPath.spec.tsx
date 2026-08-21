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

  describe('zero ancestors (Requirement 2.2 equivalent)', () => {
    it('renders only the home icon, with no ancestor links', () => {
      const { container } = render(<SearchResultAncestorPath path="/A" />);

      const homeIcon = screen.getByText('home');
      expect(homeIcon).toBeInTheDocument();

      // Only the home link itself is present; no other ancestor links exist.
      const links = container.querySelectorAll('a');
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute('href', '/');
    });
  });

  describe('trash page (mirrors PagePathHierarchicalLink isInTrash)', () => {
    it('renders the trash icon instead of the home icon', () => {
      const { container } = render(<SearchResultAncestorPath path="/trash" />);

      expect(screen.getByText('delete')).toBeInTheDocument();
      expect(screen.queryByText('home')).toBeNull();

      const links = container.querySelectorAll('a');
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute('href', '/trash');
    });
  });
});
