import type { IPageHasId } from '@growi/core';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPageWithSearchMeta } from '~/interfaces/search';

// Mock useKeywordRescroll
vi.mock('./use-keyword-rescroll', () => ({
  useKeywordRescroll: vi.fn(),
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

import { SearchResultContent } from './SearchResultContent';
import { useKeywordRescroll } from './use-keyword-rescroll';

const mockUseKeywordRescroll = vi.mocked(useKeywordRescroll);

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
    mockUseKeywordRescroll.mockReset();
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  describe('useKeywordRescroll integration', () => {
    it('should call useKeywordRescroll with the correct key', () => {
      const page = createMockPage({ _id: 'page-123' });
      const pageWithMeta = createMockPageWithMeta(page);

      render(<SearchResultContent pageWithMeta={pageWithMeta} />);

      expect(mockUseKeywordRescroll).toHaveBeenCalledTimes(1);
      const callArgs = mockUseKeywordRescroll.mock.calls[0]?.[0];
      expect(callArgs?.key).toBe('page-123');
    });

    it('should call useKeywordRescroll with a ref to the scroll container', () => {
      const page = createMockPage({ _id: 'page-123' });
      const pageWithMeta = createMockPageWithMeta(page);

      render(<SearchResultContent pageWithMeta={pageWithMeta} />);

      const callArgs = mockUseKeywordRescroll.mock.calls[0]?.[0];
      expect(callArgs?.scrollElementRef).toBeDefined();
      expect(callArgs?.scrollElementRef.current).toBeInstanceOf(HTMLElement);
      expect((callArgs?.scrollElementRef.current as HTMLElement).id).toBe(
        'search-result-content-body-container',
      );
    });

    it('should re-call useKeywordRescroll with new key when page changes', () => {
      const page1 = createMockPage({ _id: 'page-1' });
      const pageWithMeta1 = createMockPageWithMeta(page1);

      const { rerender } = render(
        <SearchResultContent pageWithMeta={pageWithMeta1} />,
      );

      const page2 = createMockPage({ _id: 'page-2' });
      const pageWithMeta2 = createMockPageWithMeta(page2);

      rerender(<SearchResultContent pageWithMeta={pageWithMeta2} />);

      // useKeywordRescroll should be called with new key on rerender
      const lastCall = mockUseKeywordRescroll.mock.calls.at(-1)?.[0];
      expect(lastCall?.key).toBe('page-2');
    });
  });
});
