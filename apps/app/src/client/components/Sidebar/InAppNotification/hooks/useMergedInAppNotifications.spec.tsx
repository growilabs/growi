import { act, renderHook } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  apiv3Post: vi.fn().mockResolvedValue({}),
  apiv3Put: vi.fn().mockResolvedValue({}),
  mutateNews: vi.fn(),
  mutateNotifications: vi.fn(),
  mutateNewsUnreadCount: vi.fn(),
  mutateNotifUnreadCount: vi.fn(),
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Post: mocks.apiv3Post,
  apiv3Put: mocks.apiv3Put,
}));

vi.mock('~/features/news/client/hooks/use-news', () => ({
  useSWRINFxNews: () => ({
    data: undefined,
    error: undefined,
    isValidating: false,
    isLoading: false,
    mutate: mocks.mutateNews,
    setSize: vi.fn(),
    size: 1,
  }),
  useSWRxNewsUnreadCount: () => ({
    data: 3,
    mutate: mocks.mutateNewsUnreadCount,
  }),
}));

vi.mock('~/stores/in-app-notification', () => ({
  useSWRINFxInAppNotifications: () => ({
    data: undefined,
    error: undefined,
    isValidating: false,
    isLoading: false,
    mutate: mocks.mutateNotifications,
    setSize: vi.fn(),
    size: 1,
  }),
  useSWRxInAppNotificationStatus: () => ({
    data: 5,
    mutate: mocks.mutateNotifUnreadCount,
  }),
}));

import { useMergedInAppNotifications } from './useMergedInAppNotifications';

describe('useMergedInAppNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleMarkAllRead', () => {
    test('calls both APIs and zeroes both unread counts when news + notifications are requested', async () => {
      const { result } = renderHook(() => useMergedInAppNotifications(false));

      await act(async () => {
        await result.current.handleMarkAllRead({
          news: true,
          notifications: true,
        });
      });

      expect(mocks.apiv3Post).toHaveBeenCalledWith('/news/mark-all-read');
      expect(mocks.apiv3Put).toHaveBeenCalledWith(
        '/in-app-notification/all-statuses-open',
      );
      expect(mocks.mutateNewsUnreadCount).toHaveBeenCalledWith(0, {
        revalidate: false,
      });
      expect(mocks.mutateNotifUnreadCount).toHaveBeenCalledWith(0, {
        revalidate: false,
      });
    });

    test('calls only the news API when notifications flag is false', async () => {
      const { result } = renderHook(() => useMergedInAppNotifications(false));

      await act(async () => {
        await result.current.handleMarkAllRead({
          news: true,
          notifications: false,
        });
      });

      expect(mocks.apiv3Post).toHaveBeenCalledWith('/news/mark-all-read');
      expect(mocks.apiv3Put).not.toHaveBeenCalled();
      expect(mocks.mutateNewsUnreadCount).toHaveBeenCalledWith(0, {
        revalidate: false,
      });
      expect(mocks.mutateNotifUnreadCount).not.toHaveBeenCalled();
    });

    test('calls only the notifications API when news flag is false', async () => {
      const { result } = renderHook(() => useMergedInAppNotifications(false));

      await act(async () => {
        await result.current.handleMarkAllRead({
          news: false,
          notifications: true,
        });
      });

      expect(mocks.apiv3Put).toHaveBeenCalledWith(
        '/in-app-notification/all-statuses-open',
      );
      expect(mocks.apiv3Post).not.toHaveBeenCalled();
      expect(mocks.mutateNotifUnreadCount).toHaveBeenCalledWith(0, {
        revalidate: false,
      });
      expect(mocks.mutateNewsUnreadCount).not.toHaveBeenCalled();
    });

    test('rolls back via revalidation when the underlying API throws', async () => {
      mocks.apiv3Post.mockRejectedValueOnce(new Error('boom'));
      const { result } = renderHook(() => useMergedInAppNotifications(false));

      await act(async () => {
        await result.current.handleMarkAllRead({
          news: true,
          notifications: false,
        });
      });

      // Re-fetch is requested with no argument on failure
      expect(mocks.mutateNews).toHaveBeenLastCalledWith();
      expect(mocks.mutateNewsUnreadCount).toHaveBeenLastCalledWith();
    });
  });

  describe('handleNewsRead', () => {
    test('decrements news unread count optimistically', () => {
      const { result } = renderHook(() => useMergedInAppNotifications(false));

      act(() => {
        result.current.handleNewsRead('news-id-1');
      });

      expect(mocks.mutateNewsUnreadCount).toHaveBeenCalledWith(
        expect.any(Function),
        { revalidate: false },
      );
      // The updater returns max(current - 1, 0)
      const updater = mocks.mutateNewsUnreadCount.mock.calls[0][0];
      expect(updater(3)).toBe(2);
      expect(updater(0)).toBe(0);
      expect(updater(undefined)).toBe(0);
    });
  });

  describe('exposed unread counts', () => {
    test('forwards the SWR-cached counts for both kinds', () => {
      const { result } = renderHook(() => useMergedInAppNotifications(false));

      expect(result.current.newsUnreadCount).toBe(3);
      expect(result.current.notifUnreadCount).toBe(5);
    });
  });
});
