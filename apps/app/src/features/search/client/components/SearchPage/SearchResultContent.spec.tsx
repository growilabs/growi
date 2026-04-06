import type { IPageHasId } from '@growi/core';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPageWithSearchMeta } from '~/interfaces/search';

// Mock watchRenderingAndReScroll
vi.mock(
  '~/client/hooks/use-content-auto-scroll/watch-rendering-and-rescroll',
  () => ({
    watchRenderingAndReScroll: vi.fn(() => vi.fn()), // returns a cleanup fn
  }),
);

// Mock scrollWithinContainer
vi.mock('~/client/util/smooth-scroll', () => ({
  scrollWithinContainer: vi.fn(),
}));

// Mock next/dynamic
vi.mock('next/dynamic', () => ({
  default: () => {
    return function MockDynamic() {
      return null;
    };
  },
}));

// Mock various hooks and stores used by SearchResultContent
vi.mock('~/services/layout/use-should-expand-content', () => ({
  useShouldExpandContent: vi.fn(() => false),
}));
vi.mock('~/states/global', () => ({
  useCurrentUser: vi.fn(() => null),
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
vi.mock('~/stores/page-listing', () => ({
  mutatePageList: vi.fn(),
  mutatePageTree: vi.fn(),
  mutateRecentlyUpdated: vi.fn(),
}));
vi.mock('~/stores/renderer', () => ({
  useSearchResultOptions: vi.fn(() => ({ data: null })),
}));
vi.mock('~/stores/search', () => ({
  mutateSearching: vi.fn(),
}));
vi.mock('next-i18next', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}));
vi.mock('~/components/Common/PagePathNav', () => ({
  PagePathNav: () => null,
}));

import { watchRenderingAndReScroll } from '~/client/hooks/use-content-auto-scroll/watch-rendering-and-rescroll';
import { scrollWithinContainer } from '~/client/util/smooth-scroll';

import { SearchResultContent } from './SearchResultContent';

const mockWatchRenderingAndReScroll = vi.mocked(watchRenderingAndReScroll);
const mockScrollWithinContainer = vi.mocked(scrollWithinContainer);

const createMockPage = (overrides: Partial<IPageHasId> = {}): IPageHasId =>
  ({
    _id: 'page-123',
    path: '/test/page',
    revision: 'rev-456',
    wip: false,
    ...overrides,
  }) as unknown as IPageHasId;

const createMockPageWithMeta = (page: IPageHasId = createMockPage()) =>
  ({ data: page }) as unknown as IPageWithSearchMeta;

describe('SearchResultContent', () => {
  beforeEach(() => {
    mockWatchRenderingAndReScroll.mockReset();
    mockWatchRenderingAndReScroll.mockReturnValue(vi.fn());
    mockScrollWithinContainer.mockReset();
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  describe('watchRenderingAndReScroll integration', () => {
    it('should call watchRenderingAndReScroll with the scroll container element', () => {
      const page = createMockPage({ _id: 'page-123' });
      const pageWithMeta = createMockPageWithMeta(page);

      render(<SearchResultContent pageWithMeta={pageWithMeta} />);

      expect(mockWatchRenderingAndReScroll).toHaveBeenCalledTimes(1);
      const firstCall = mockWatchRenderingAndReScroll.mock.calls[0];
      expect(firstCall).toBeDefined();
      const containerArg = firstCall?.[0];
      expect(containerArg).toBeInstanceOf(HTMLElement);
      expect((containerArg as HTMLElement).id).toBe(
        'search-result-content-body-container',
      );
    });

    it('should pass a scrollToKeyword function as the second argument', () => {
      const page = createMockPage();
      const pageWithMeta = createMockPageWithMeta(page);

      render(<SearchResultContent pageWithMeta={pageWithMeta} />);

      const scrollToKeyword = mockWatchRenderingAndReScroll.mock.calls[0]?.[1];
      expect(typeof scrollToKeyword).toBe('function');
    });

    it('scrollToKeyword should scroll to .highlighted-keyword within container', () => {
      const page = createMockPage();
      const pageWithMeta = createMockPageWithMeta(page);

      render(<SearchResultContent pageWithMeta={pageWithMeta} />);

      const firstCall = mockWatchRenderingAndReScroll.mock.calls[0];
      expect(firstCall).toBeDefined();
      const container = firstCall?.[0] as HTMLElement;
      const scrollToKeyword = firstCall?.[1];

      // Inject a highlighted-keyword element into the container
      const keyword = document.createElement('span');
      keyword.className = 'highlighted-keyword';
      container.appendChild(keyword);

      vi.spyOn(keyword, 'getBoundingClientRect').mockReturnValue({
        top: 250,
        bottom: 270,
        left: 0,
        right: 100,
        width: 100,
        height: 20,
        x: 0,
        y: 250,
        toJSON: () => ({}),
      });
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 600,
        left: 0,
        right: 100,
        width: 100,
        height: 500,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });

      const result = scrollToKeyword();

      // distance = 250 - 100 - 30 = 120
      expect(mockScrollWithinContainer).toHaveBeenCalledWith(container, 120);
      expect(result).toBe(true);

      container.removeChild(keyword);
    });

    it('scrollToKeyword should return false when no .highlighted-keyword element exists', () => {
      const page = createMockPage();
      const pageWithMeta = createMockPageWithMeta(page);

      render(<SearchResultContent pageWithMeta={pageWithMeta} />);

      const scrollToKeyword = mockWatchRenderingAndReScroll.mock.calls[0]?.[1];
      expect(scrollToKeyword).toBeDefined();

      const result = scrollToKeyword?.();

      expect(result).toBe(false);
      expect(mockScrollWithinContainer).not.toHaveBeenCalled();
    });

    it('should call watchRenderingAndReScroll cleanup when component unmounts', () => {
      const mockCleanup = vi.fn();
      mockWatchRenderingAndReScroll.mockReturnValue(mockCleanup);

      const page = createMockPage();
      const pageWithMeta = createMockPageWithMeta(page);

      const { unmount } = render(
        <SearchResultContent pageWithMeta={pageWithMeta} />,
      );

      unmount();

      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });
  });
});
