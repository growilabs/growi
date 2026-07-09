import { fireEvent, render, screen } from '@testing-library/react';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => {
  const apiv3Post = vi.fn().mockResolvedValue({});
  const mutate = vi.fn();
  const routerPush = vi.fn();
  const i18nLanguage = { current: 'ja_JP' };
  return { apiv3Post, mutate, routerPush, i18nLanguage };
});

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Post: mocks.apiv3Post,
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      get language() {
        return mocks.i18nLanguage.current;
      },
    },
  }),
}));

import type { INewsItemWithReadStatus } from '../../interfaces/news-item';
import { NewsItem } from './NewsItem';

const makeNewsItem = (
  overrides: Partial<INewsItemWithReadStatus> = {},
): INewsItemWithReadStatus => ({
  _id: new mongoose.Types.ObjectId(),
  externalId: 'test-001',
  title: { ja_JP: 'テストニュース', en_US: 'Test News' },
  publishedAt: new Date('2026-01-01T00:00:00Z'),
  fetchedAt: new Date(),
  isRead: false,
  ...overrides,
});

describe('NewsItem', () => {
  const onReadMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.i18nLanguage.current = 'ja_JP';
  });

  describe('emoji display', () => {
    test('should display emoji when provided', () => {
      const item = makeNewsItem({ emoji: '🚀' });
      render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );
      expect(screen.getByText('🚀')).toBeTruthy();
    });

    test('should display 📢 fallback when emoji is not set', () => {
      const item = makeNewsItem({ emoji: undefined });
      render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );
      expect(screen.getByText('📢')).toBeTruthy();
    });
  });

  describe('locale fallback', () => {
    test('should display ja_JP title when i18n language is ja_JP', () => {
      mocks.i18nLanguage.current = 'ja_JP';
      const item = makeNewsItem({
        title: { ja_JP: '日本語タイトル', en_US: 'English Title' },
      });
      render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );
      expect(screen.getByText('日本語タイトル')).toBeTruthy();
    });

    test('should fallback to ja_JP when i18n language has no match', () => {
      mocks.i18nLanguage.current = 'de_DE';
      const item = makeNewsItem({
        title: { ja_JP: '日本語タイトル', en_US: 'English Title' },
      });
      render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );
      expect(screen.getByText('日本語タイトル')).toBeTruthy();
    });

    test('should fallback to en_US when ja_JP is not available', () => {
      mocks.i18nLanguage.current = 'de_DE';
      const item = makeNewsItem({ title: { en_US: 'English Only' } });
      render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );
      expect(screen.getByText('English Only')).toBeTruthy();
    });

    test('should fallback to first available key when neither ja_JP nor en_US', () => {
      mocks.i18nLanguage.current = 'de_DE';
      const item = makeNewsItem({ title: { fr_FR: 'Titre Français' } });
      render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );
      expect(screen.getByText('Titre Français')).toBeTruthy();
    });
  });

  describe('unread/read visual styling', () => {
    test('should apply fw-bold class for unread items', () => {
      const item = makeNewsItem({ isRead: false });
      const { container } = render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );
      // Title should have fw-bold
      const title = container.querySelector('.fw-bold');
      expect(title).not.toBeNull();
    });

    test('should apply fw-normal class for read items', () => {
      const item = makeNewsItem({ isRead: true });
      const { container } = render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );
      const title = container.querySelector('.fw-normal');
      expect(title).not.toBeNull();
    });

    test('should show unread dot for unread items', () => {
      const item = makeNewsItem({ isRead: false });
      const { container } = render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );
      const dot = container.querySelector('.bg-primary.rounded-circle');
      expect(dot).not.toBeNull();
    });
  });

  describe('click handling', () => {
    test('should call mark-read API when clicked', async () => {
      const item = makeNewsItem({ isRead: false });
      render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );

      const element = screen.getByRole('button');
      fireEvent.click(element);

      // Wait for async
      await vi.waitFor(() => {
        expect(mocks.apiv3Post).toHaveBeenCalledWith(
          '/news/mark-read',
          expect.objectContaining({ newsItemId: item._id.toString() }),
        );
      });
    });

    test('should navigate to the news feed page anchored to the clicked item', async () => {
      const item = makeNewsItem({ isRead: false });
      render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );

      fireEvent.click(screen.getByRole('button'));

      await vi.waitFor(() => {
        expect(mocks.routerPush).toHaveBeenCalledWith(
          `/_news?page=1#news-${item._id.toString()}`,
          undefined,
          { scroll: false },
        );
      });
    });

    // Guards the `page = pageIndex + 1` contract with a non-zero index:
    // an implementation that hardcodes `?page=1` or drops the `+1` would
    // still pass the pageIndex=0 tests above.
    test('should navigate to the page derived from a non-zero pageIndex', async () => {
      const item = makeNewsItem({ isRead: false });
      render(
        <NewsItem item={item} pageIndex={2} onReadMutate={onReadMutate} />,
      );

      fireEvent.click(screen.getByRole('button'));

      await vi.waitFor(() => {
        expect(mocks.routerPush).toHaveBeenCalledWith(
          `/_news?page=3#news-${item._id.toString()}`,
          undefined,
          { scroll: false },
        );
      });
    });

    // When no valid page mapping exists (e.g. the sidebar unread-only filter
    // is active), the `?page` query must be omitted instead of pointing at a
    // possibly wrong page.
    test('should navigate without a page query when pageIndex is not provided', async () => {
      const item = makeNewsItem({ isRead: false });
      render(<NewsItem item={item} onReadMutate={onReadMutate} />);

      fireEvent.click(screen.getByRole('button'));

      await vi.waitFor(() => {
        expect(mocks.routerPush).toHaveBeenCalledWith(
          `/_news#news-${item._id.toString()}`,
          undefined,
          { scroll: false },
        );
      });
    });

    test('should navigate even when url is not set', async () => {
      const item = makeNewsItem({ url: undefined, isRead: false });
      render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );

      fireEvent.click(screen.getByRole('button'));

      await vi.waitFor(() => {
        expect(mocks.routerPush).toHaveBeenCalledWith(
          `/_news?page=1#news-${item._id.toString()}`,
          undefined,
          { scroll: false },
        );
      });
    });

    test('should call onReadMutate after marking as read', async () => {
      const item = makeNewsItem({ isRead: false });
      render(
        <NewsItem item={item} pageIndex={0} onReadMutate={onReadMutate} />,
      );

      fireEvent.click(screen.getByRole('button'));

      await vi.waitFor(() => {
        expect(onReadMutate).toHaveBeenCalled();
      });
    });
  });
});
