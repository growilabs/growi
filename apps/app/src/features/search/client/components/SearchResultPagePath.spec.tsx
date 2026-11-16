import { render, screen } from '@testing-library/react';

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
});
