import type { JSX, ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet } from '~/client/util/apiv1-client';
import { useShareLinkId } from '~/states/page/hooks';

import { useSWRxPageComment } from './comment';

vi.mock('~/client/util/apiv1-client', () => ({
  apiGet: vi.fn().mockResolvedValue({ comments: [], ok: true }),
  apiPost: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('~/states/page/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/states/page/hooks')>()),
  useShareLinkId: vi.fn(),
}));

// Fresh SWR cache per render so cache keys never leak across tests.
const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

describe('useSWRxPageComment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends page_id and shareLinkId in a share-link context', async () => {
    // Arrange
    vi.mocked(useShareLinkId).mockReturnValue('share-link-1');

    // Act
    renderHook(() => useSWRxPageComment('page-1'), { wrapper });

    // Assert: shareLinkId is co-sent alongside the single page_id, and no
    // separate `pageId` is added (single-ID invariant).
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(apiGet).toHaveBeenCalledWith('/comments.get', {
      page_id: 'page-1',
      shareLinkId: 'share-link-1',
    });
  });

  it('sends only page_id on a normal (non-shared) page', async () => {
    // Arrange
    vi.mocked(useShareLinkId).mockReturnValue(undefined);

    // Act
    renderHook(() => useSWRxPageComment('page-1'), { wrapper });

    // Assert: exact object match fails if a stray shareLinkId/pageId is sent.
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(apiGet).toHaveBeenCalledWith('/comments.get', { page_id: 'page-1' });
  });

  it('treats an empty-string shareLinkId as non-shared', async () => {
    // Arrange
    vi.mocked(useShareLinkId).mockReturnValue('  ');

    // Act
    renderHook(() => useSWRxPageComment('page-1'), { wrapper });

    // Assert
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(apiGet).toHaveBeenCalledWith('/comments.get', { page_id: 'page-1' });
  });

  it('separates the SWR cache by shareLinkId (distinct fetch per share link)', async () => {
    // Arrange: a SHARED cache across both renders, so a second fetch can only
    // happen if the cache key actually differs by shareLinkId. (A per-render
    // fresh cache would fetch regardless and prove nothing.)
    const sharedCache = new Map();
    const sharedWrapper = ({
      children,
    }: {
      children: ReactNode;
    }): JSX.Element => (
      <SWRConfig value={{ provider: () => sharedCache, dedupingInterval: 0 }}>
        {children}
      </SWRConfig>
    );

    vi.mocked(useShareLinkId).mockReturnValue('share-link-1');
    renderHook(() => useSWRxPageComment('page-1'), { wrapper: sharedWrapper });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

    // Act: same pageId, different shareLinkId -> must miss the cache and refetch
    vi.mocked(useShareLinkId).mockReturnValue('share-link-2');
    renderHook(() => useSWRxPageComment('page-1'), { wrapper: sharedWrapper });

    // Assert: a separate request is issued for the new share-link context.
    // If shareLinkId were dropped from the key, this would be a cache hit and
    // stay at 1 call -> the test would fail, catching the regression.
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(apiGet).toHaveBeenLastCalledWith('/comments.get', {
      page_id: 'page-1',
      shareLinkId: 'share-link-2',
    });
  });

  it('does not fetch when pageId is null', () => {
    // Arrange
    vi.mocked(useShareLinkId).mockReturnValue(undefined);

    // Act
    renderHook(() => useSWRxPageComment(null), { wrapper });

    // Assert
    expect(apiGet).not.toHaveBeenCalled();
  });
});
