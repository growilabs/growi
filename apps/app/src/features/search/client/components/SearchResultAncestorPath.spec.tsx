import { act, render, screen } from '@testing-library/react';

import {
  type FakeResizeObserverControl,
  installFakeResizeObserver,
  stubElementWidths,
} from '../hooks/layout-test-utils';
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

  describe('ancestor segments are never character-truncated (Requirement 3.4, 3.5)', () => {
    it('does not apply the character-level ellipsis class to any ancestor link', () => {
      render(<SearchResultAncestorPath path={DEEP_PATH} />);

      for (const name of ['Projects', 'notes']) {
        expect(screen.getByRole('link', { name })).not.toHaveClass(
          'text-truncate',
        );
      }
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
      render(<SearchResultAncestorPath path="/trash/foo" />);

      expect(screen.getByText('delete').closest('a')).toHaveAttribute(
        'href',
        '/trash',
      );
      expect(screen.queryByText('home')).toBeNull();
      expect(screen.getByText('/').closest('a')).toHaveAttribute('href', '/');
    });

    it('renders the home icon for the /trash page itself, which sits under the top page', () => {
      render(<SearchResultAncestorPath path="/trash" />);

      expect(screen.getByText('home')).toBeInTheDocument();
      expect(screen.queryByText('delete')).toBeNull();
    });

    it('renders the trash root before the ancestors of a trashed page', () => {
      const { container } = render(
        <SearchResultAncestorPath path="/trash/foo/bar" />,
      );

      expect(container.textContent).toBe('delete/trash/foo');
    });
  });

  describe('collapsing to fit the available width (Requirement 1.3, 3.2, 3.3, 3.5, 3.7, 3.9)', () => {
    // Layout model: every rendered character (including the root icon's
    // ligature text) is CHAR_WIDTH wide and nothing in the row shrinks, so the
    // row overflows exactly when its text is wider than the available width.
    const CHAR_WIDTH = 10;

    let availableWidth: number;
    let restoreWidths: () => void;
    let resizeObserver: FakeResizeObserverControl;

    const getRow = (): HTMLElement => {
      const row = document.querySelector<HTMLElement>('[title]');
      if (row == null) throw new Error('ancestor path row not found');
      return row;
    };

    const renderedPath = (): string => getRow().textContent ?? '';

    beforeEach(() => {
      availableWidth = 1000;
      resizeObserver = installFakeResizeObserver();
      restoreWidths = stubElementWidths((element) => {
        if (!element.hasAttribute('title')) return undefined;
        // Highlighted (bold) characters count double
        const highlightedLength = Array.from(
          element.querySelectorAll('em'),
        ).reduce((sum, em) => sum + (em.textContent?.length ?? 0), 0);
        const contentWidth =
          ((element.textContent?.length ?? 0) + highlightedLength) * CHAR_WIDTH;
        return {
          scrollWidth: Math.max(availableWidth, contentWidth),
          clientWidth: availableWidth,
        };
      });
    });

    afterEach(() => {
      restoreWidths();
      resizeObserver.restore();
    });

    // 'home/Projects/…/notes' needs 210, 'home/…/notes' 120, 'home/…' 60
    it('keeps the base form when it fits', () => {
      availableWidth = 300;
      render(<SearchResultAncestorPath path={DEEP_PATH} />);

      expect(renderedPath()).toBe('home/Projects/…/notes');
    });

    it('folds the first ancestor before the parent when the base form overflows', () => {
      availableWidth = 150;
      render(<SearchResultAncestorPath path={DEEP_PATH} />);

      expect(renderedPath()).toBe('home/…/notes');
      expect(screen.queryByRole('link', { name: 'Projects' })).toBeNull();
    });

    it('folds the parent last, leaving only the root and the ellipsis', () => {
      availableWidth = 80;
      render(<SearchResultAncestorPath path={DEEP_PATH} />);

      expect(renderedPath()).toBe('home/…');
      expect(screen.queryByRole('link', { name: 'notes' })).toBeNull();
    });

    it.each([
      300, 150, 80, 30,
    ])('renders exactly one non-link ellipsis and no bare adjacent separators at width %i', (width) => {
      availableWidth = width;
      render(<SearchResultAncestorPath path={DEEP_PATH} />);

      expect(renderedPath()).not.toContain('//');
      const ellipses = screen.getAllByText('…');
      expect(ellipses).toHaveLength(1);
      expect(ellipses[0].closest('a')).toBeNull();
    });

    it('keeps the surviving parent as a link with its href and highlight after folding', () => {
      // 'home/A/…/D' needs 100, 'home/…/D' 80
      availableWidth = 90;
      const { container } = render(
        <SearchResultAncestorPath
          path="/A/B/C/D/E"
          highlightedPath="/A/B/C/<em>D</em>/E"
        />,
      );

      expect(renderedPath()).toBe('home/…/D');
      const em = container.querySelector('em');
      expect(em?.textContent).toBe('D');
      expect(em?.closest('a')).toHaveAttribute('href', '/A/B/C/D');
    });

    it('keeps the full path as the title while collapsed', () => {
      availableWidth = 30;
      render(<SearchResultAncestorPath path={DEEP_PATH} />);

      expect(getRow().getAttribute('title')).toBe(DEEP_PATH);
    });

    it('restores ancestors when the available width grows', () => {
      availableWidth = 80;
      render(<SearchResultAncestorPath path={DEEP_PATH} />);
      // The browser's initial notification
      act(() => resizeObserver.notifyResize(getRow(), availableWidth));
      expect(renderedPath()).toBe('home/…');

      availableWidth = 300;
      act(() => resizeObserver.notifyResize(getRow(), availableWidth));

      expect(renderedPath()).toBe('home/Projects/…/notes');
      expect(screen.getByRole('link', { name: 'notes' })).toHaveAttribute(
        'href',
        '/Projects/GROWI/GROWI.cloud/team/notes',
      );
    });

    it('re-fits from the base form when the path changes', () => {
      availableWidth = 150;
      const { rerender } = render(
        <SearchResultAncestorPath path={DEEP_PATH} />,
      );
      expect(renderedPath()).toBe('home/…/notes');

      rerender(<SearchResultAncestorPath path="/A/B/C" />);

      expect(renderedPath()).toBe('home/A/B');
    });

    it('re-fits from the base form when only the highlight changes', () => {
      // With "Projects" highlighted the base form needs 290; without it, 210
      availableWidth = 250;
      const { rerender } = render(
        <SearchResultAncestorPath
          path={DEEP_PATH}
          highlightedPath={DEEP_PATH.replace('Projects', '<em>Projects</em>')}
        />,
      );
      expect(renderedPath()).toBe('home/…/notes');

      // Same page in a new search whose keyword no longer hits an ancestor
      rerender(
        <SearchResultAncestorPath path={DEEP_PATH} highlightedPath={null} />,
      );

      expect(renderedPath()).toBe('home/Projects/…/notes');
    });
  });
});
