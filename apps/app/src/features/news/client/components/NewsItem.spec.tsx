import { fireEvent, render, screen } from '@testing-library/react';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => {
  const apiv3Post = vi.fn().mockResolvedValue({});
  const mutate = vi.fn();
  const i18nLanguage = { current: 'ja_JP' };
  return { apiv3Post, mutate, i18nLanguage };
});

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Post: mocks.apiv3Post,
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

// Mock window.open
const mockOpen = vi.fn();
vi.stubGlobal('open', mockOpen);

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
      render(<NewsItem item={item} onReadMutate={onReadMutate} />);
      expect(screen.getByText('🚀')).toBeTruthy();
    });

    test('should display 📢 fallback when emoji is not set', () => {
      const item = makeNewsItem({ emoji: undefined });
      render(<NewsItem item={item} onReadMutate={onReadMutate} />);
      expect(screen.getByText('📢')).toBeTruthy();
    });
  });

  describe('locale fallback', () => {
    test('should display ja_JP title when i18n language is ja_JP', () => {
      mocks.i18nLanguage.current = 'ja_JP';
      const item = makeNewsItem({
        title: { ja_JP: '日本語タイトル', en_US: 'English Title' },
      });
      render(<NewsItem item={item} onReadMutate={onReadMutate} />);
      expect(screen.getByText('日本語タイトル')).toBeTruthy();
    });

    test('should fallback to ja_JP when i18n language has no match', () => {
      mocks.i18nLanguage.current = 'de_DE';
      const item = makeNewsItem({
        title: { ja_JP: '日本語タイトル', en_US: 'English Title' },
      });
      render(<NewsItem item={item} onReadMutate={onReadMutate} />);
      expect(screen.getByText('日本語タイトル')).toBeTruthy();
    });

    test('should fallback to en_US when ja_JP is not available', () => {
      mocks.i18nLanguage.current = 'de_DE';
      const item = makeNewsItem({ title: { en_US: 'English Only' } });
      render(<NewsItem item={item} onReadMutate={onReadMutate} />);
      expect(screen.getByText('English Only')).toBeTruthy();
    });

    test('should fallback to first available key when neither ja_JP nor en_US', () => {
      mocks.i18nLanguage.current = 'de_DE';
      const item = makeNewsItem({ title: { fr_FR: 'Titre Français' } });
      render(<NewsItem item={item} onReadMutate={onReadMutate} />);
      expect(screen.getByText('Titre Français')).toBeTruthy();
    });
  });

  describe('unread/read visual styling', () => {
    test('should apply fw-bold class for unread items', () => {
      const item = makeNewsItem({ isRead: false });
      const { container } = render(
        <NewsItem item={item} onReadMutate={onReadMutate} />,
      );
      // Title should have fw-bold
      const title = container.querySelector('.fw-bold');
      expect(title).not.toBeNull();
    });

    test('should apply fw-normal class for read items', () => {
      const item = makeNewsItem({ isRead: true });
      const { container } = render(
        <NewsItem item={item} onReadMutate={onReadMutate} />,
      );
      const title = container.querySelector('.fw-normal');
      expect(title).not.toBeNull();
    });

    test('should show unread dot for unread items', () => {
      const item = makeNewsItem({ isRead: false });
      const { container } = render(
        <NewsItem item={item} onReadMutate={onReadMutate} />,
      );
      const dot = container.querySelector('.bg-primary.rounded-circle');
      expect(dot).not.toBeNull();
    });
  });

  describe('click handling', () => {
    test('should call mark-read API when clicked', async () => {
      const item = makeNewsItem({ isRead: false });
      render(<NewsItem item={item} onReadMutate={onReadMutate} />);

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

    test('should open URL in new tab when url is set', async () => {
      const item = makeNewsItem({
        url: 'https://github.com/growi',
        isRead: false,
      });
      render(<NewsItem item={item} onReadMutate={onReadMutate} />);

      const element = screen.getByRole('button');
      fireEvent.click(element);

      await vi.waitFor(() => {
        expect(mockOpen).toHaveBeenCalledWith(
          'https://github.com/growi',
          '_blank',
          'noopener,noreferrer',
        );
      });
    });

    test('should NOT open URL when url is not set', async () => {
      const item = makeNewsItem({ url: undefined, isRead: false });
      render(<NewsItem item={item} onReadMutate={onReadMutate} />);

      const element = screen.getByRole('button');
      fireEvent.click(element);

      await vi.waitFor(() => {
        expect(mocks.apiv3Post).toHaveBeenCalled();
      });
      expect(mockOpen).not.toHaveBeenCalled();
    });

    test('should call onReadMutate after marking as read', async () => {
      const item = makeNewsItem({ isRead: false });
      render(<NewsItem item={item} onReadMutate={onReadMutate} />);

      fireEvent.click(screen.getByRole('button'));

      await vi.waitFor(() => {
        expect(onReadMutate).toHaveBeenCalled();
      });
    });
  });
});
