import { act, render, screen } from '@testing-library/react';

import {
  type FakeResizeObserverControl,
  installFakeResizeObserver,
  stubElementWidths,
} from '../hooks/layout-test-utils';
import { SearchResultPagePath } from './SearchResultPagePath';

import styles from './SearchResultPagePath.module.scss';

describe('SearchResultPagePath', () => {
  describe('deep path (display units >= 4)', () => {
    // ancestors: Projects / GROWI / GROWI.cloud / team / notes, page name: memo
    const deepPath = '/Projects/GROWI/GROWI.cloud/team/notes/memo';

    it('should render the page name inside a <strong> element', () => {
      render(<SearchResultPagePath path={deepPath} />);

      const pageName = screen.getByText('memo');
      expect(pageName.tagName).toBe('STRONG');
    });

    it('should render exactly one ellipsis as an independent node', () => {
      render(<SearchResultPagePath path={deepPath} />);

      const ellipses = screen.getAllByText('…');
      expect(ellipses).toHaveLength(1);
      // The ellipsis must be its own node, not embedded in a segment's text.
      expect(ellipses[0].textContent).toBe('…');
    });

    it('should keep the first ancestor and the parent ancestor visible', () => {
      render(<SearchResultPagePath path={deepPath} />);

      // first ancestor
      expect(screen.getByText('Projects')).toBeInTheDocument();
      // parent ancestor (directly before the page name)
      expect(screen.getByText('notes')).toBeInTheDocument();
    });
  });

  describe('tooltip', () => {
    it('should always expose the full path as the container title attribute', () => {
      const { container } = render(
        <SearchResultPagePath path="/Projects/GROWI/GROWI.cloud/team/notes/memo" />,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.getAttribute('title')).toBe(
        '/Projects/GROWI/GROWI.cloud/team/notes/memo',
      );
    });

    it('should expose the full path as title even for a short (non-truncated) path', () => {
      const { container } = render(<SearchResultPagePath path="/A/B" />);

      const root = container.firstElementChild as HTMLElement;
      expect(root.getAttribute('title')).toBe('/A/B');
    });
  });

  describe('short path (display units <= 3)', () => {
    it('should render every segment without an ellipsis', () => {
      render(<SearchResultPagePath path="/A/B" />);

      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('B')).toBeInTheDocument();
      expect(screen.queryByText('…')).toBeNull();
    });

    it('should render the last segment as the bold page name', () => {
      render(<SearchResultPagePath path="/A/B" />);

      expect(screen.getByText('B').tagName).toBe('STRONG');
    });
  });

  describe('root path', () => {
    it('should render "/" for the root path', () => {
      render(<SearchResultPagePath path="/" />);

      expect(screen.getByText('/')).toBeInTheDocument();
      expect(screen.queryByText('…')).toBeNull();
    });

    it('should render the root "/" as the bold page name, like the legacy label', () => {
      render(<SearchResultPagePath path="/" />);

      expect(screen.getByText('/').tagName).toBe('STRONG');
    });
  });

  describe('character truncation is limited to the page name (Requirement 3.4, 3.6)', () => {
    // Bootstrap's character-level ellipsis utility
    const CHAR_TRUNCATION_CLASS = 'text-truncate';

    it('should apply character truncation to the page name', () => {
      render(
        <SearchResultPagePath path="/Projects/GROWI/GROWI.cloud/team/notes/memo" />,
      );

      expect(screen.getByText('memo')).toHaveClass(CHAR_TRUNCATION_CLASS);
    });

    it('should never apply character truncation to a visible ancestor segment', () => {
      render(
        <SearchResultPagePath path="/Projects/GROWI/GROWI.cloud/team/notes/memo" />,
      );

      expect(screen.getByText('Projects')).not.toHaveClass(
        CHAR_TRUNCATION_CLASS,
      );
      expect(screen.getByText('notes')).not.toHaveClass(CHAR_TRUNCATION_CLASS);
    });

    it('should character-truncate only the page name of a short path', () => {
      render(<SearchResultPagePath path="/A/B" />);

      expect(screen.getByText('A')).not.toHaveClass(CHAR_TRUNCATION_CLASS);
      expect(screen.getByText('B')).toHaveClass(CHAR_TRUNCATION_CLASS);
    });
  });

  describe('one-line safety net (structure)', () => {
    it('should apply the single-line container class to the root element', () => {
      const { container } = render(<SearchResultPagePath path="/A/B" />);

      const root = container.firstElementChild as HTMLElement;
      expect(root.classList.contains(styles['search-result-page-path'])).toBe(
        true,
      );
    });
  });

  describe('collapsing to fit the available width (Requirement 3.2, 3.3, 3.5, 3.6, 3.7)', () => {
    // Layout model: every rendered character is CHAR_WIDTH wide. Everything but
    // the page name keeps its full width; the page name shrinks into whatever
    // width is left, as the flex row does in a browser.
    const CHAR_WIDTH = 10;
    const CHAR_TRUNCATION_CLASS = 'text-truncate';

    let availableWidth: number;
    let restoreWidths: () => void;
    let resizeObserver: FakeResizeObserverControl;

    const pageNameWidthOf = (row: HTMLElement): number =>
      (row.querySelector('strong')?.textContent?.length ?? 0) * CHAR_WIDTH;

    const fixedWidthOf = (row: HTMLElement): number =>
      (row.textContent?.length ?? 0) * CHAR_WIDTH - pageNameWidthOf(row);

    const getRow = (): HTMLElement => {
      const row = document.querySelector<HTMLElement>('[title]');
      if (row == null) throw new Error('path row not found');
      return row;
    };

    beforeEach(() => {
      availableWidth = 1000;
      resizeObserver = installFakeResizeObserver();
      restoreWidths = stubElementWidths((element) => {
        const row = element.closest<HTMLElement>('[title]');
        if (row == null) return undefined;
        if (element === row) {
          return {
            scrollWidth: Math.max(availableWidth, fixedWidthOf(row)),
            clientWidth: availableWidth,
          };
        }
        if (element.tagName === 'STRONG') {
          const nameWidth = pageNameWidthOf(row);
          const leftWidth = Math.max(availableWidth - fixedWidthOf(row), 0);
          return {
            scrollWidth: nameWidth,
            clientWidth: Math.min(nameWidth, leftWidth),
          };
        }
        return undefined;
      });
    });

    afterEach(() => {
      restoreWidths();
      resizeObserver.restore();
    });

    const renderedPath = (): string => getRow().textContent ?? '';

    // '/Projects/…/notes/memo' needs 220, '/…/notes/memo' 130, '/…/memo' 70
    const deepPath = '/Projects/GROWI/GROWI.cloud/team/notes/memo';

    it('keeps the base form when it fits', () => {
      availableWidth = 300;
      render(<SearchResultPagePath path={deepPath} />);

      expect(renderedPath()).toBe('/Projects/…/notes/memo');
    });

    it('folds the first ancestor before the parent when the base form overflows', () => {
      availableWidth = 150;
      render(<SearchResultPagePath path={deepPath} />);

      expect(renderedPath()).toBe('/…/notes/memo');
      expect(screen.getAllByText('…')).toHaveLength(1);
      expect(screen.queryByText('Projects')).toBeNull();
    });

    it('folds the parent last, leaving a single ellipsis and the page name', () => {
      availableWidth = 80;
      render(<SearchResultPagePath path={deepPath} />);

      expect(renderedPath()).toBe('/…/memo');
      expect(screen.getAllByText('…')).toHaveLength(1);
    });

    it('treats a character-truncated page name as not fitting', () => {
      // The ancestors fit, but only 20 of the page name's 40 remain
      availableWidth = 200;
      render(<SearchResultPagePath path={deepPath} />);

      expect(renderedPath()).toBe('/…/notes/memo');
    });

    it('also collapses a short (3-unit) path when it overflows', () => {
      // '/Team/notes/memo' needs 160, '/…/notes/memo' 130
      availableWidth = 140;
      render(<SearchResultPagePath path="/Team/notes/memo" />);

      expect(renderedPath()).toBe('/…/notes/memo');
    });

    it.each([
      300, 200, 150, 80, 30,
    ])('never renders bare adjacent separators at width %i', (width) => {
      availableWidth = width;
      render(<SearchResultPagePath path={deepPath} />);

      expect(renderedPath()).not.toContain('//');
      expect(screen.getAllByText('…')).toHaveLength(1);
    });

    it('leaves only the page name to be character-truncated at the maximum level', () => {
      availableWidth = 30;
      render(<SearchResultPagePath path={deepPath} />);

      expect(renderedPath()).toBe('/…/memo');
      const truncatable = getRow().querySelectorAll(
        `.${CHAR_TRUNCATION_CLASS}`,
      );
      expect(Array.from(truncatable, (el) => el.textContent)).toEqual(['memo']);
    });

    it('keeps the full path as the title while collapsed', () => {
      availableWidth = 30;
      render(<SearchResultPagePath path={deepPath} />);

      expect(getRow().getAttribute('title')).toBe(deepPath);
    });

    it('restores ancestors when the available width grows', () => {
      availableWidth = 80;
      render(<SearchResultPagePath path={deepPath} />);
      // The browser's initial notification
      act(() => resizeObserver.notifyResize(getRow(), availableWidth));
      expect(renderedPath()).toBe('/…/memo');

      availableWidth = 300;
      act(() => resizeObserver.notifyResize(getRow(), availableWidth));

      expect(renderedPath()).toBe('/Projects/…/notes/memo');
    });

    it('re-fits from the base form when the path changes', () => {
      availableWidth = 150;
      const { rerender } = render(<SearchResultPagePath path={deepPath} />);
      expect(renderedPath()).toBe('/…/notes/memo');

      rerender(<SearchResultPagePath path="/A/B" />);

      expect(renderedPath()).toBe('/A/B');
    });
  });
});
