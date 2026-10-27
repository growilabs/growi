import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NextjsRoutingType } from '~/pages/utils/nextjs-routing-utils';
import { useFetchCurrentPage } from '~/states/page';

import { useSharedPageCSRFetch } from './use-shared-page-csr-fetch';

vi.mock('~/states/page');

const mockFetchCurrentPage = vi.fn();

describe('useSharedPageCSRFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (useFetchCurrentPage as ReturnType<typeof vi.fn>).mockReturnValue({
      fetchCurrentPage: mockFetchCurrentPage,
      isLoading: false,
      error: null,
    });
  });

  it.each([
    NextjsRoutingType.FROM_OUTSIDE,
    NextjsRoutingType.SAME_ROUTE,
  ])('should fetch the shared page by its id on %s navigation', (nextjsRoutingType) => {
    renderHook(() =>
      useSharedPageCSRFetch({
        nextjsRoutingType,
        skipSSR: false,
        pageId: 'shared-page-id',
      }),
    );

    expect(mockFetchCurrentPage).toHaveBeenCalledTimes(1);
    expect(mockFetchCurrentPage).toHaveBeenCalledWith({
      force: true,
      pageId: 'shared-page-id',
    });
  });

  it('should fetch the shared page by its id when SSR is skipped on INITIAL', () => {
    renderHook(() =>
      useSharedPageCSRFetch({
        nextjsRoutingType: NextjsRoutingType.INITIAL,
        skipSSR: true,
        pageId: 'shared-page-id',
      }),
    );

    expect(mockFetchCurrentPage).toHaveBeenCalledTimes(1);
    expect(mockFetchCurrentPage).toHaveBeenCalledWith({
      force: true,
      pageId: 'shared-page-id',
    });
  });

  it('should NOT fetch on INITIAL when the page is server-side rendered', () => {
    renderHook(() =>
      useSharedPageCSRFetch({
        nextjsRoutingType: NextjsRoutingType.INITIAL,
        skipSSR: false,
        pageId: 'shared-page-id',
      }),
    );

    expect(mockFetchCurrentPage).not.toHaveBeenCalled();
  });

  it('should NOT fetch when the share link has no page to show', () => {
    renderHook(() =>
      useSharedPageCSRFetch({
        nextjsRoutingType: NextjsRoutingType.FROM_OUTSIDE,
        skipSSR: false,
        pageId: undefined,
      }),
    );

    expect(mockFetchCurrentPage).not.toHaveBeenCalled();
  });

  it('should fetch the next shared page when navigating to another share link', () => {
    const { rerender } = renderHook(
      ({ pageId }: { pageId: string }) =>
        useSharedPageCSRFetch({
          nextjsRoutingType: NextjsRoutingType.SAME_ROUTE,
          skipSSR: false,
          pageId,
        }),
      { initialProps: { pageId: 'first-page-id' } },
    );

    rerender({ pageId: 'second-page-id' });

    expect(mockFetchCurrentPage).toHaveBeenCalledTimes(2);
    expect(mockFetchCurrentPage).toHaveBeenLastCalledWith({
      force: true,
      pageId: 'second-page-id',
    });
  });
});
