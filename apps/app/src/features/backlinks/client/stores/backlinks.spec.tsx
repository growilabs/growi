import type { JSX, ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useIsGuestUser } from '~/states/context';

import type { IBacklink } from '../../interfaces/backlink';
import { useSWRxBacklinks } from './backlinks';

// Wrap an untyped mock so mockResolvedValue is not constrained to AxiosResponse.
const mockApiv3Get = vi.fn();
vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: (...args: unknown[]) => mockApiv3Get(...args),
}));
vi.mock('~/states/context', () => ({
  useIsGuestUser: vi.fn(),
}));

const backlinksOf = (...paths: string[]): IBacklink[] =>
  paths.map((path, i) => ({ pageId: `id-${i}`, path }));

// Fresh SWR cache per render so cache keys never leak across tests.
const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

// A cache shared across renders/mounts, so an extra fetch can only come from a
// changed cache key or a real revalidation -- never from a cold cache.
const createSharedCacheWrapper = () => {
  const sharedCache = new Map();
  return ({ children }: { children: ReactNode }): JSX.Element => (
    <SWRConfig value={{ provider: () => sharedCache, dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
};

describe('useSWRxBacklinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useIsGuestUser).mockReturnValue(false);
  });

  it('fetches the backlinks endpoint with pageId and returns the backlink list', async () => {
    // Arrange
    const backlinks = backlinksOf('/foo', '/bar');
    mockApiv3Get.mockResolvedValue({ data: { backlinks } });

    // Act
    const { result } = renderHook(() => useSWRxBacklinks('page-1'), {
      wrapper,
    });

    // Assert: the request carries pageId, and the hook exposes only the array
    await waitFor(() => expect(result.current.data).toEqual(backlinks));
    expect(mockApiv3Get).toHaveBeenCalledWith('/page/backlinks', {
      pageId: 'page-1',
    });
  });

  it('does not fetch when pageId is null', () => {
    // Act
    renderHook(() => useSWRxBacklinks(null), { wrapper });

    // Assert
    expect(mockApiv3Get).not.toHaveBeenCalled();
  });

  it('revalidates when the page id changes', async () => {
    // Arrange: a SHARED cache across renders so a second fetch can only happen
    // if the cache key actually changed with the page id.
    const sharedWrapper = createSharedCacheWrapper();
    mockApiv3Get.mockResolvedValue({ data: { backlinks: [] } });

    // Act
    const { rerender } = renderHook(({ id }) => useSWRxBacklinks(id), {
      wrapper: sharedWrapper,
      initialProps: { id: 'page-1' },
    });
    await waitFor(() => expect(mockApiv3Get).toHaveBeenCalledTimes(1));

    rerender({ id: 'page-2' });

    // Assert: a distinct page id misses the cache and triggers a new fetch
    await waitFor(() => expect(mockApiv3Get).toHaveBeenCalledTimes(2));
    expect(mockApiv3Get).toHaveBeenLastCalledWith('/page/backlinks', {
      pageId: 'page-2',
    });
  });

  it('separates the cache by guest state (refetches after login)', async () => {
    // Arrange: shared cache; only a changed key can cause a second fetch.
    const sharedWrapper = createSharedCacheWrapper();
    mockApiv3Get.mockResolvedValue({ data: { backlinks: [] } });

    vi.mocked(useIsGuestUser).mockReturnValue(true);
    const { rerender } = renderHook(() => useSWRxBacklinks('page-1'), {
      wrapper: sharedWrapper,
    });
    await waitFor(() => expect(mockApiv3Get).toHaveBeenCalledTimes(1));

    // Act: same page id, now logged in -> guest state flips, key must differ
    vi.mocked(useIsGuestUser).mockReturnValue(false);
    rerender();

    // Assert
    await waitFor(() => expect(mockApiv3Get).toHaveBeenCalledTimes(2));
  });

  it('revalidates a warm cache on remount, so a reopened panel reads fresh data', async () => {
    // Arrange: warm the shared cache with a first mount
    const sharedWrapper = createSharedCacheWrapper();
    mockApiv3Get.mockResolvedValue({ data: { backlinks: [] } });

    const first = renderHook(() => useSWRxBacklinks('page-1'), {
      wrapper: sharedWrapper,
    });
    await waitFor(() => expect(mockApiv3Get).toHaveBeenCalledTimes(1));
    first.unmount();

    // Act: remount with the SAME key, as when the panel is closed and reopened
    renderHook(() => useSWRxBacklinks('page-1'), { wrapper: sharedWrapper });

    // Assert: the cached list is revalidated rather than served for the rest of
    // the session -- backlinks depend on grants that can change server-side
    await waitFor(() => expect(mockApiv3Get).toHaveBeenCalledTimes(2));
  });
});
