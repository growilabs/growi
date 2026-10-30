import type { IPageHasId } from '@growi/core';
import { fireEvent, render, screen } from '@testing-library/react';

import type { IPageWithSearchMeta } from '~/interfaces/search';

// --- Mock hooks/stores consumed by PageListItemL ---
// These are UI-state / server-state hooks unrelated to the ancestor-path
// rendering under test; stubbing them keeps the tests focused on the
// renderTruncatedAncestorPath branching (Requirement 7, 8, 9).
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

import {
  PageListItemL,
  type TruncatedAncestorPathRenderer,
} from './PageListItemL';

// A plain data object (not mock<T>()) so fields the component starts reading
// later are not silently backed by truthy auto-stubs.
const createPageData = (overrides: Partial<IPageHasId> = {}): IPageHasId => ({
  _id: 'page123',
  path: '/A/B/C',
  status: 'published',
  tags: [],
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  seenUsers: [],
  parent: null,
  descendantCount: 0,
  isEmpty: false,
  grant: 1,
  grantedUsers: [],
  grantedGroups: [],
  liker: [],
  commentCount: 0,
  slackChannels: '',
  deleteUser: 'user123',
  deletedAt: new Date('2024-01-01T00:00:00.000Z'),
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

const em = (text: string): string =>
  `<em class="highlighted-keyword">${text}</em>`;

// Echoes what PageListItemL hands to the injected renderer.
const renderAncestorPathStub: TruncatedAncestorPathRenderer = (
  path,
  highlightedPath,
) => <span>{`ancestor-row:${path}|${highlightedPath ?? ''}`}</span>;

// The title row links to the page's permalink (returnPathForURL).
const getTitleLink = (container: HTMLElement, pageId: string) =>
  container.querySelector(`a[href="/${pageId}"]`);

describe('PageListItemL', () => {
  describe('when renderTruncatedAncestorPath is omitted (default)', () => {
    it('renders every ancestor as its own link', () => {
      render(
        <PageListItemL
          page={createPageWithMeta(createPageData({ path: '/A/B/C' }))}
          isReadOnlyUser={false}
        />,
      );

      expect(screen.getByRole('link', { name: 'A' })).toHaveAttribute(
        'href',
        '/A',
      );
      expect(screen.getByRole('link', { name: 'B' })).toHaveAttribute(
        'href',
        '/A/B',
      );
    });

    it('renders the checkbox and reports the checked state via onCheckboxChanged', () => {
      const onCheckboxChanged = vi.fn();
      render(
        <PageListItemL
          page={createPageWithMeta(createPageData())}
          isReadOnlyUser={false}
          onCheckboxChanged={onCheckboxChanged}
        />,
      );

      fireEvent.click(screen.getByTestId('cb-select'));

      expect(onCheckboxChanged).toHaveBeenCalledWith(true, 'page123');
    });

    it('triggers onClickItem when the row is clicked', () => {
      const onClickItem = vi.fn();
      render(
        <PageListItemL
          page={createPageWithMeta(createPageData())}
          isReadOnlyUser={false}
          onClickItem={onClickItem}
        />,
      );

      fireEvent.click(screen.getByTestId('page-list-item-L'));

      expect(onClickItem).toHaveBeenCalledWith('page123');
    });

    it('shows the old (non-bundled) page name for a date-suffixed path', () => {
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(
            createPageData({ _id: 'p1', path: '/A/B/2024/01/15' }),
          )}
          isReadOnlyUser={false}
        />,
      );

      expect(getTitleLink(container, 'p1')?.textContent).toBe('15');
    });

    it('keeps the page-name highlight when an ancestor is highlighted too', () => {
      // Requirement 8.1: the opt-in page-name logic must not leak into the default path.
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(
            createPageData({ _id: 'p5', path: '/foo/bar/foo' }),
            `/${em('foo')}/bar/${em('foo')}`,
          )}
          isReadOnlyUser={false}
        />,
      );

      const highlight = getTitleLink(container, 'p5')?.querySelector('em');
      expect(highlight?.textContent).toBe('foo');
    });
  });

  describe('when renderTruncatedAncestorPath is provided', () => {
    it('renders the ancestor path through the injected renderer instead of per-ancestor links', () => {
      render(
        <PageListItemL
          page={createPageWithMeta(
            createPageData({ path: '/A/B/C' }),
            `/A/${em('B')}/C`,
          )}
          isReadOnlyUser={false}
          renderTruncatedAncestorPath={renderAncestorPathStub}
        />,
      );

      expect(
        screen.getByText(`ancestor-row:/A/B/C|/A/${em('B')}/C`),
      ).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'A' })).toBeNull();
    });

    it('bundles a trailing date into a single page name in the title row', () => {
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(
            createPageData({ _id: 'p2', path: '/A/B/2024/01/15' }),
          )}
          isReadOnlyUser={false}
          renderTruncatedAncestorPath={renderAncestorPathStub}
        />,
      );

      expect(getTitleLink(container, 'p2')?.textContent).toBe('2024/01/15');
    });

    it('keeps the page-name highlight when an ancestor is highlighted too (Requirement 6.1)', () => {
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(
            createPageData({ _id: 'p6', path: '/foo/bar/foo' }),
            `/${em('foo')}/bar/${em('foo')}`,
          )}
          isReadOnlyUser={false}
          renderTruncatedAncestorPath={renderAncestorPathStub}
        />,
      );

      const highlight = getTitleLink(container, 'p6')?.querySelector('em');
      expect(highlight?.textContent).toBe('foo');
    });

    it('keeps the highlight inside a bundled date page name', () => {
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(
            createPageData({ _id: 'p3', path: '/A/B/2024/01/15' }),
            `/A/B/${em('2024')}/01/15`,
          )}
          isReadOnlyUser={false}
          renderTruncatedAncestorPath={renderAncestorPathStub}
        />,
      );

      const titleLink = getTitleLink(container, 'p3');
      expect(titleLink?.textContent).toBe('2024/01/15');
      expect(titleLink?.querySelector('em')?.textContent).toBe('2024');
    });

    it('falls back to the plain bundled page name when the highlight spans the date separators', () => {
      const { container } = render(
        <PageListItemL
          page={createPageWithMeta(
            createPageData({ _id: 'p4', path: '/A/B/2024/01/15' }),
            `/A/B/${em('2024/01/15')}`,
          )}
          isReadOnlyUser={false}
          renderTruncatedAncestorPath={renderAncestorPathStub}
        />,
      );

      const titleLink = getTitleLink(container, 'p4');
      expect(titleLink?.textContent).toBe('2024/01/15');
      expect(titleLink?.querySelector('em')).toBeNull();
    });

    it('still supports checkbox selection and row click', () => {
      const onCheckboxChanged = vi.fn();
      const onClickItem = vi.fn();
      render(
        <PageListItemL
          page={createPageWithMeta(createPageData())}
          isReadOnlyUser={false}
          renderTruncatedAncestorPath={renderAncestorPathStub}
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
