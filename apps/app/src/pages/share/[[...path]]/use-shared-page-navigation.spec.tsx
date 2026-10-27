import type { ReactNode } from 'react';
import type { IPageInfoExt } from '@growi/core';
import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { mock } from 'vitest-mock-extended';

import type { IPageToShowRevisionWithMeta } from '~/pages/general-page';
import { NextjsRoutingType } from '~/pages/utils/nextjs-routing-utils';
import {
  useCurrentPageData,
  useFetchCurrentPage,
  usePageNotFound,
} from '~/states/page';
import { useHydratePageAtoms } from '~/states/page/hydrate';

import type { Stage2EachProps } from './types';
import { useSharedPageNavigation } from './use-shared-page-navigation';

vi.mock('~/states/page', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/states/page')>()),
  useFetchCurrentPage: vi.fn(),
}));

const mockFetchCurrentPage = vi.fn();

type SharedPageData = IPageToShowRevisionWithMeta['data'];

const pageWithMetaOf = (
  id: string,
  path: string,
): IPageToShowRevisionWithMeta => ({
  data: mock<SharedPageData>({
    // WHY: PageDocument types _id as `string & ObjectId`, which no string literal satisfies
    _id: id as SharedPageData['_id'],
    path,
  }),
  meta: mock<IPageInfoExt>({ isNotFound: false }),
});

const notFoundPageWithMeta: Stage2EachProps['pageWithMeta'] = {
  data: null,
  meta: { isNotFound: true, isForbidden: false },
};

type NavigationProps = Parameters<typeof useSharedPageNavigation>[0];

// Mirrors SharedPage: atoms are hydrated from the first props only, then the
// hook under test applies each later navigation.
const renderSharedPage = (initialProps: NavigationProps) => {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(
    (props: NavigationProps) => {
      useHydratePageAtoms(
        props.pageWithMeta?.data ?? undefined,
        props.pageWithMeta?.meta,
      );
      useSharedPageNavigation(props);
      return {
        currentPage: useCurrentPageData(),
        isNotFound: usePageNotFound(),
      };
    },
    { initialProps, wrapper },
  );
};

const initialProps: NavigationProps = {
  nextjsRoutingType: NextjsRoutingType.INITIAL,
  currentPathname: '/Sandbox/previous',
  pageWithMeta: pageWithMetaOf('previous-page-id', '/Sandbox/previous'),
  isExpired: undefined,
  skipSSR: false,
};

describe('useSharedPageNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useFetchCurrentPage).mockReturnValue({
      fetchCurrentPage: mockFetchCurrentPage,
      isLoading: false,
      error: null,
    });
  });

  it.each([
    NextjsRoutingType.FROM_OUTSIDE,
    NextjsRoutingType.SAME_ROUTE,
  ])('shows the navigated-to shared page on %s navigation', (nextjsRoutingType) => {
    const { result, rerender } = renderSharedPage(initialProps);

    rerender({
      nextjsRoutingType,
      currentPathname: '/share/next-link-id',
      pageWithMeta: pageWithMetaOf('next-page-id', '/Sandbox/next'),
      isExpired: false,
      skipSSR: false,
    });

    expect(result.current.currentPage?._id).toBe('next-page-id');
    expect(result.current.isNotFound).toBe(false);
    expect(mockFetchCurrentPage).not.toHaveBeenCalled();
  });

  it('clears the previous page when navigating to a missing share link', () => {
    const { result, rerender } = renderSharedPage(initialProps);

    rerender({
      nextjsRoutingType: NextjsRoutingType.FROM_OUTSIDE,
      currentPathname: '/share/missing-link-id',
      pageWithMeta: notFoundPageWithMeta,
      isExpired: undefined,
      skipSSR: undefined,
    });

    expect(result.current.currentPage).toBeUndefined();
    expect(result.current.isNotFound).toBe(true);
    expect(mockFetchCurrentPage).not.toHaveBeenCalled();
  });

  it('shows the page of an expired share link without fetching it', () => {
    const { result, rerender } = renderSharedPage(initialProps);

    rerender({
      nextjsRoutingType: NextjsRoutingType.FROM_OUTSIDE,
      currentPathname: '/share/expired-link-id',
      pageWithMeta: pageWithMetaOf('expired-page-id', '/Sandbox/expired'),
      isExpired: true,
      skipSSR: true,
    });

    expect(result.current.currentPage?._id).toBe('expired-page-id');
    expect(mockFetchCurrentPage).not.toHaveBeenCalled();
  });

  it('fetches the page body by id when SSR is skipped on navigation', () => {
    const { rerender } = renderSharedPage(initialProps);

    rerender({
      nextjsRoutingType: NextjsRoutingType.SAME_ROUTE,
      currentPathname: '/share/next-link-id',
      pageWithMeta: pageWithMetaOf('next-page-id', '/Sandbox/next'),
      isExpired: false,
      skipSSR: true,
    });

    expect(mockFetchCurrentPage).toHaveBeenCalledTimes(1);
    expect(mockFetchCurrentPage).toHaveBeenCalledWith({
      force: true,
      pageId: 'next-page-id',
    });
  });

  it('fetches the page body by id when SSR is skipped on INITIAL', () => {
    renderSharedPage({ ...initialProps, skipSSR: true });

    expect(mockFetchCurrentPage).toHaveBeenCalledTimes(1);
    expect(mockFetchCurrentPage).toHaveBeenCalledWith({
      force: true,
      pageId: 'previous-page-id',
    });
  });

  it('does not refetch or overwrite the page when re-rendered without navigating', () => {
    const { result, rerender } = renderSharedPage({
      ...initialProps,
      skipSSR: true,
    });

    // superjson deserialization yields new props objects on every render
    rerender({
      ...initialProps,
      pageWithMeta: pageWithMetaOf('previous-page-id', '/Sandbox/previous'),
      skipSSR: true,
    });

    expect(mockFetchCurrentPage).toHaveBeenCalledTimes(1);
    expect(result.current.currentPage?._id).toBe('previous-page-id');
  });
});
