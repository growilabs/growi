import { fireEvent, render, screen } from '@testing-library/react';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => {
  const routerPush = vi.fn();
  const useSWRxNewsPage = vi.fn();
  // Mutable holder so each test can shape the router before rendering.
  const router = {
    query: {} as Record<string, string | string[] | undefined>,
    asPath: '/_news',
  };
  return { routerPush, useSWRxNewsPage, router };
});

vi.mock('next/router', () => ({
  useRouter: () => ({
    pathname: '/_news',
    query: mocks.router.query,
    asPath: mocks.router.asPath,
    push: mocks.routerPush,
  }),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

vi.mock('../hooks/use-news', () => ({
  useSWRxNewsPage: mocks.useSWRxNewsPage,
}));

import type { PaginateResult } from '~/interfaces/in-app-notification';

import type { INewsItemWithReadStatus } from '../../interfaces/news-item';
import { newsItemAnchorId } from '../consts';
import { NewsFeed } from './NewsFeed';

const makeNewsItem = (
  overrides: Partial<INewsItemWithReadStatus> = {},
): INewsItemWithReadStatus => ({
  _id: new mongoose.Types.ObjectId(),
  externalId: `test-${new mongoose.Types.ObjectId().toString()}`,
  title: { en_US: 'Test News' },
  publishedAt: new Date('2026-01-01T00:00:00Z'),
  fetchedAt: new Date(),
  isRead: false,
  ...overrides,
});

const makePage = (
  docs: INewsItemWithReadStatus[],
  overrides: Partial<PaginateResult<INewsItemWithReadStatus>> = {},
): PaginateResult<INewsItemWithReadStatus> => ({
  docs,
  totalDocs: docs.length,
  hasNextPage: false,
  hasPrevPage: false,
  limit: 10,
  nextPage: null,
  offset: 0,
  page: 1,
  pagingCounter: 1,
  prevPage: null,
  totalPages: 1,
  ...overrides,
});

const swrResponse = (
  data: PaginateResult<INewsItemWithReadStatus> | undefined,
  isValidating = false,
) => ({
  data,
  error: undefined,
  isValidating,
  isLoading: isValidating && data == null,
  mutate: vi.fn(),
});

const scrollIntoViewMock = vi.fn();

beforeAll(() => {
  // happy-dom does not implement scrollIntoView
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

describe('NewsFeed', () => {
  beforeEach(() => {
    mocks.router.query = {};
    mocks.router.asPath = '/_news';
    window.location.hash = '';
  });

  describe('rendering states', () => {
    test('should show a spinner while the first load is in flight', () => {
      mocks.useSWRxNewsPage.mockReturnValue(swrResponse(undefined, true));

      render(<NewsFeed />);

      expect(screen.getByText('progress_activity')).toBeTruthy();
      expect(screen.queryByText('in_app_notification.no_news')).toBeNull();
    });

    test('should show the empty message when the feed has no items', () => {
      mocks.useSWRxNewsPage.mockReturnValue(swrResponse(makePage([])));

      render(<NewsFeed />);

      expect(screen.getByText('in_app_notification.no_news')).toBeTruthy();
    });

    test('should render the items of the current page', () => {
      const items = [
        makeNewsItem({ title: { en_US: 'First News' } }),
        makeNewsItem({ title: { en_US: 'Second News' } }),
      ];
      mocks.useSWRxNewsPage.mockReturnValue(swrResponse(makePage(items)));

      render(<NewsFeed />);

      expect(screen.getByText('First News')).toBeTruthy();
      expect(screen.getByText('Second News')).toBeTruthy();
    });
  });

  describe('pagination', () => {
    test('should not show the pager when all items fit on one page', () => {
      const items = [makeNewsItem(), makeNewsItem()];
      mocks.useSWRxNewsPage.mockReturnValue(
        swrResponse(makePage(items, { totalDocs: 2 })),
      );

      render(<NewsFeed />);

      expect(screen.queryByRole('navigation')).toBeNull();
    });

    test('should show the pager when totalDocs exceeds one page', () => {
      const items = Array.from({ length: 10 }, () => makeNewsItem());
      mocks.useSWRxNewsPage.mockReturnValue(
        swrResponse(makePage(items, { totalDocs: 25, totalPages: 3 })),
      );

      render(<NewsFeed />);

      expect(screen.getByRole('navigation')).toBeTruthy();
    });

    test('should push the selected page with scroll disabled', () => {
      const items = Array.from({ length: 10 }, () => makeNewsItem());
      mocks.useSWRxNewsPage.mockReturnValue(
        swrResponse(makePage(items, { totalDocs: 25, totalPages: 3 })),
      );

      render(<NewsFeed />);
      fireEvent.click(screen.getByText('2'));

      expect(mocks.routerPush).toHaveBeenCalledWith(
        { pathname: '/_news', query: { page: 2 }, hash: undefined },
        undefined,
        { scroll: false },
      );
    });
  });

  describe('anchor scroll', () => {
    test('should scroll to the hash target once it is present on the page', () => {
      const target = makeNewsItem();
      const anchor = newsItemAnchorId(target._id.toString());
      window.location.hash = `#${anchor}`;
      mocks.router.asPath = `/_news#${anchor}`;
      mocks.useSWRxNewsPage.mockReturnValue(swrResponse(makePage([target])));

      render(<NewsFeed />);

      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    });

    // Regression guard: with `keepPreviousData` the previous page's items are
    // still rendered when the URL changes, so the anchor target only appears
    // after the new page's data arrives — the scroll must fire at that point.
    test('should scroll after the target page arrives while stale items are shown', () => {
      const target = makeNewsItem();
      const anchor = newsItemAnchorId(target._id.toString());
      const stalePage = makePage(
        Array.from({ length: 10 }, () => makeNewsItem()),
        { totalDocs: 25, totalPages: 3 },
      );
      window.location.hash = `#${anchor}`;
      mocks.router.query = { page: '3' };
      mocks.router.asPath = `/_news?page=3#${anchor}`;

      // keepPreviousData: page 1 items are still rendered right after navigation
      mocks.useSWRxNewsPage.mockReturnValue(swrResponse(stalePage, true));
      const { rerender } = render(<NewsFeed />);
      expect(scrollIntoViewMock).not.toHaveBeenCalled();

      // page 3 arrives with the SAME number of items as the stale page —
      // an items.length-based trigger would not re-fire in this case
      const targetPage = makePage(
        [target, ...Array.from({ length: 9 }, () => makeNewsItem())],
        { totalDocs: 25, totalPages: 3, page: 3 },
      );
      mocks.useSWRxNewsPage.mockReturnValue(swrResponse(targetPage));
      rerender(<NewsFeed />);

      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    });

    test('should not scroll again on background revalidation of the same page', () => {
      const target = makeNewsItem();
      const anchor = newsItemAnchorId(target._id.toString());
      window.location.hash = `#${anchor}`;
      mocks.router.asPath = `/_news#${anchor}`;
      mocks.useSWRxNewsPage.mockReturnValue(swrResponse(makePage([target])));

      const { rerender } = render(<NewsFeed />);
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      // revalidation returns a NEW data object for the same navigation
      mocks.useSWRxNewsPage.mockReturnValue(swrResponse(makePage([target])));
      rerender(<NewsFeed />);

      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    });
  });
});
