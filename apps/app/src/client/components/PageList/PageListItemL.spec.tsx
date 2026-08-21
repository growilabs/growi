import type { IPageHasId } from '@growi/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import type { IPageWithSearchMeta } from '~/interfaces/search';

// --- Mock hooks/stores consumed by PageListItemL ---
// These are UI-state / server-state hooks unrelated to the ancestor-path
// rendering under test; stubbing them keeps the tests focused on the
// isPathTruncationEnabled branching (Requirement 7, 8, 9).
vi.mock('~/states/ui/device', () => ({
  useDeviceLargerThanLg: vi.fn(() => [true]),
}));
vi.mock('~/states/ui/modal/page-delete', () => ({
  usePageDeleteModalActions: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock('~/states/ui/modal/page-duplicate', () => ({
  usePageDuplicateModalActions: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock('~/states/ui/modal/page-rename', () => ({
  usePageRenameModalActions: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock('~/states/ui/modal/put-back-page', () => ({
  usePutBackPageModalActions: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock('~/stores/bookmark', () => ({
  useSWRMUTxCurrentUserBookmarks: vi.fn(() => ({ trigger: vi.fn() })),
}));
vi.mock('~/stores/page', () => ({
  useSWRxPageInfo: vi.fn(() => ({ data: undefined })),
  useSWRMUTxPageInfo: vi.fn(() => ({ trigger: vi.fn() })),
}));
vi.mock('next-i18next', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}));

import { PageListItemL } from './PageListItemL';

const createPageData = (overrides: Partial<IPageHasId> = {}): IPageHasId =>
  mock<IPageHasId>({
    _id: 'page123',
    path: '/A/B/C',
    liker: [],
    seenUsers: [],
    commentCount: 0,
    grant: 1,
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    lastUpdateUser: undefined,
    ...overrides,
  });

const createPageWithMeta = (
  pageData: IPageHasId,
  highlightedPath?: string,
): IPageWithSearchMeta => ({
  data: pageData,
  meta: {
    elasticSearchResult:
      highlightedPath != null ? { highlightedPath } : undefined,
  },
});

describe('PageListItemL', () => {
  describe('when isPathTruncationEnabled is omitted (default)', () => {
    it('renders the ancestor path via PagePathHierarchicalLink', () => {
      const pageData = createPageData({ path: '/A/B/C' });
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(pageData)}
          isReadOnlyUser={false}
        />,
      );

      expect(
        container.querySelector('#grw-page-path-hierarchical-link'),
      ).not.toBeNull();
    });

    it('does not render SearchResultAncestorPath (no full-path title tooltip)', () => {
      const pageData = createPageData({ path: '/A/B/C' });
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(pageData)}
          isReadOnlyUser={false}
        />,
      );

      expect(container.querySelector('[title="/A/B/C"]')).toBeNull();
    });

    it('renders the checkbox and reports the checked state via onCheckboxChanged', () => {
      const pageData = createPageData({ path: '/A/B/C' });
      const onCheckboxChanged = vi.fn();
      render(
        <PageListItemL
          page={createPageWithMeta(pageData)}
          isReadOnlyUser={false}
          onCheckboxChanged={onCheckboxChanged}
        />,
      );

      const checkbox = screen.getByTestId('cb-select');
      fireEvent.click(checkbox);

      expect(onCheckboxChanged).toHaveBeenCalledWith(true, 'page123');
    });

    it('triggers onClickItem when the row is clicked', () => {
      const pageData = createPageData({ path: '/A/B/C' });
      const onClickItem = vi.fn();
      render(
        <PageListItemL
          page={createPageWithMeta(pageData)}
          isReadOnlyUser={false}
          onClickItem={onClickItem}
        />,
      );

      fireEvent.click(screen.getByTestId('page-list-item-L'));

      expect(onClickItem).toHaveBeenCalledWith('page123');
    });

    it('shows the old (non-bundled) page name for a date-suffixed path', () => {
      const pageData = createPageData({ _id: 'p1', path: '/A/B/2024/01/15' });
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(pageData)}
          isReadOnlyUser={false}
        />,
      );

      const titleLink = container.querySelector('a[href="/p1"]');
      expect(titleLink?.textContent).toBe('15');
    });
  });

  describe('when isPathTruncationEnabled is explicitly false', () => {
    it('renders identically to the omitted case', () => {
      const pageData = createPageData({ path: '/A/B/C' });
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(pageData)}
          isReadOnlyUser={false}
          isPathTruncationEnabled={false}
        />,
      );

      expect(
        container.querySelector('#grw-page-path-hierarchical-link'),
      ).not.toBeNull();
      expect(container.querySelector('[title="/A/B/C"]')).toBeNull();
    });
  });

  describe('when isPathTruncationEnabled is true', () => {
    it('renders SearchResultAncestorPath instead of PagePathHierarchicalLink', () => {
      const pageData = createPageData({ path: '/A/B/C' });
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(pageData)}
          isReadOnlyUser={false}
          isPathTruncationEnabled
        />,
      );

      expect(container.querySelector('[title="/A/B/C"]')).not.toBeNull();
      expect(
        container.querySelector('#grw-page-path-hierarchical-link'),
      ).toBeNull();
    });

    it('bundles a trailing date into a single page name in the title row', () => {
      const pageData = createPageData({ _id: 'p2', path: '/A/B/2024/01/15' });
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(pageData)}
          isReadOnlyUser={false}
          isPathTruncationEnabled
        />,
      );

      const titleLink = container.querySelector('a[href="/p2"]');
      expect(titleLink?.textContent).toBe('2024/01/15');
    });

    it('falls back to the plain bundled page name when a search highlight lands on the date suffix', () => {
      // Requirement 6/7 regression: an ES <em> landing on/inside a trailing
      // date used to break the date-bundling regex on the highlighted string
      // only, desyncing the page name from the ancestor row (which reads the
      // plain path) -- see tasks.md/design.md notes on this bug.
      const pageData = createPageData({ _id: 'p3', path: '/A/B/2024/01/15' });
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(pageData, '/A/B/<em>2024</em>/01/15')}
          isReadOnlyUser={false}
          isPathTruncationEnabled
        />,
      );

      const titleLink = container.querySelector('a[href="/p3"]');
      expect(titleLink?.textContent).toBe('2024/01/15');
    });

    it('falls back to the plain bundled page name when the whole date is highlighted (no orphaned closing tag)', () => {
      const pageData = createPageData({ _id: 'p4', path: '/A/B/2024/01/15' });
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(pageData, '/A/B/<em>2024/01/15</em>')}
          isReadOnlyUser={false}
          isPathTruncationEnabled
        />,
      );

      const titleLink = container.querySelector('a[href="/p4"]');
      expect(titleLink?.textContent).toBe('2024/01/15');
      expect(titleLink?.innerHTML).not.toContain('</em>');
    });

    it('still supports checkbox selection and row click', () => {
      const pageData = createPageData({ path: '/A/B/C' });
      const onCheckboxChanged = vi.fn();
      const onClickItem = vi.fn();
      render(
        <PageListItemL
          page={createPageWithMeta(pageData)}
          isReadOnlyUser={false}
          isPathTruncationEnabled
          onCheckboxChanged={onCheckboxChanged}
          onClickItem={onClickItem}
        />,
      );

      fireEvent.click(screen.getByTestId('cb-select'));
      expect(onCheckboxChanged).toHaveBeenCalledWith(true, 'page123');

      fireEvent.click(screen.getByTestId('page-list-item-L'));
      expect(onClickItem).toHaveBeenCalledWith('page123');
    });
  });
});
