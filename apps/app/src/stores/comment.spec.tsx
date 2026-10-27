import type { JSX, ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { apiPost } from '~/client/util/apiv1-client';
import { apiv3Get } from '~/client/util/apiv3-client';
import { useSWRxCommentList } from '~/features/comment/client/stores/comment-list';
import type {
  ICommentListItem,
  ListCommentsResponseBody,
} from '~/features/comment/interfaces';
import { useShareLinkId } from '~/states/page/hooks';

import { useSWRxPageComment } from './comment';

vi.mock('~/client/util/apiv1-client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('~/client/util/apiv3-client', () => ({ apiv3Get: vi.fn() }));
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

type ListResponse = Awaited<
  ReturnType<typeof apiv3Get<ListCommentsResponseBody>>
>;

const mockListResponse = (comments: ICommentListItem[]): void => {
  const response = mock<ListResponse>();
  response.data = { comments };
  vi.mocked(apiv3Get).mockResolvedValue(response);
};

const buildRow = (
  id: string,
  overrides: Partial<ICommentListItem> = {},
): ICommentListItem => ({
  _id: id,
  id,
  v: 0,
  __v: 0,
  page: 'page-1',
  pageId: 'page-1',
  creator: null,
  creatorId: null,
  revision: 'rev-1',
  revisionId: 'rev-1',
  replyTo: null,
  replyToId: null,
  comment: `comment ${id}`,
  commentPosition: -1,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  isInline: false,
  quote: null,
  prefix: null,
  suffix: null,
  approxOffset: null,
  anchorOriginRevisionId: null,
  resolvedById: null,
  resolvedAt: null,
  ...overrides,
});

const inlineRow = (
  id: string,
  overrides: Partial<ICommentListItem> = {},
): ICommentListItem =>
  buildRow(id, {
    isInline: true,
    creatorId: 'user-1',
    quote: 'quoted',
    prefix: 'pre',
    suffix: 'suf',
    approxOffset: 0,
    anchorOriginRevisionId: 'rev-1',
    ...overrides,
  });

const postArgs = {
  commentForm: { comment: 'new', revisionId: 'rev-1', replyTo: undefined },
  slackNotificationForm: { isSlackEnabled: false, slackChannels: undefined },
};

describe('useSWRxPageComment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useShareLinkId).mockReturnValue(undefined);
    mockListResponse([]);
  });

  describe('which comments it returns', () => {
    it('returns only normal comments and their replies, never inline rows, keeping the response order', async () => {
      // Arrange: newest-first, as the list API answers
      mockListResponse([
        buildRow('normal-reply', {
          replyTo: 'normal-2',
          replyToId: 'normal-2',
        }),
        inlineRow('inline-reply', {
          replyTo: 'inline-1',
          replyToId: 'inline-1',
          quote: null,
        }),
        buildRow('normal-2'),
        inlineRow('inline-1'),
        buildRow('normal-1'),
      ]);

      // Act
      const { result } = renderHook(() => useSWRxPageComment('page-1'), {
        wrapper,
      });

      // Assert
      await waitFor(() => expect(result.current.data).toBeDefined());
      expect(result.current.data?.map((c) => c._id)).toEqual([
        'normal-reply',
        'normal-2',
        'normal-1',
      ]);
    });

    it('returns an empty list when the page has only inline comments', async () => {
      // Arrange
      mockListResponse([inlineRow('inline-1')]);

      // Act
      const { result } = renderHook(() => useSWRxPageComment('page-1'), {
        wrapper,
      });

      // Assert
      await waitFor(() => expect(result.current.data).toEqual([]));
    });

    it('keeps the same array across re-renders while the list is unchanged', async () => {
      // Arrange
      mockListResponse([buildRow('normal-1'), inlineRow('inline-1')]);
      const { result, rerender } = renderHook(
        () => useSWRxPageComment('page-1'),
        { wrapper },
      );
      await waitFor(() => expect(result.current.data).toHaveLength(1));
      const first = result.current.data;

      // Act
      rerender();

      // Assert
      expect(result.current.data).toBe(first);
    });
  });

  describe('how it fetches', () => {
    it('fetches the shared comment list with only pageId on a normal page', async () => {
      // Act
      const { result } = renderHook(() => useSWRxPageComment('page-1'), {
        wrapper,
      });

      // Assert
      await waitFor(() => expect(result.current.data).toEqual([]));
      expect(apiv3Get).toHaveBeenCalledTimes(1);
      expect(apiv3Get).toHaveBeenCalledWith('/comments', { pageId: 'page-1' });
    });

    it('sends pageId and shareLinkId on a share-link page, and still hides inline rows', async () => {
      // Arrange
      vi.mocked(useShareLinkId).mockReturnValue('share-link-1');
      mockListResponse([inlineRow('inline-1'), buildRow('normal-1')]);

      // Act
      const { result } = renderHook(() => useSWRxPageComment('page-1'), {
        wrapper,
      });

      // Assert
      await waitFor(() => expect(result.current.data).toBeDefined());
      expect(apiv3Get).toHaveBeenCalledWith('/comments', {
        pageId: 'page-1',
        shareLinkId: 'share-link-1',
      });
      expect(result.current.data?.map((c) => c._id)).toEqual(['normal-1']);
    });

    it('never calls the legacy /comments.get endpoint', async () => {
      // Arrange
      const { apiGet } = await import('~/client/util/apiv1-client');

      // Act
      const { result } = renderHook(() => useSWRxPageComment('page-1'), {
        wrapper,
      });

      // Assert
      await waitFor(() => expect(result.current.data).toEqual([]));
      expect(apiGet).not.toHaveBeenCalled();
    });

    it('does not fetch when pageId is null', async () => {
      // Act
      const { result } = renderHook(() => useSWRxPageComment(null), {
        wrapper,
      });

      // Assert
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(apiv3Get).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });
  });

  describe('revalidation after writes', () => {
    it.each([
      [
        'post',
        (hook: ReturnType<typeof useSWRxPageComment>) => hook.post(postArgs),
        '/comments.add',
      ],
      [
        'update',
        (hook: ReturnType<typeof useSWRxPageComment>) =>
          hook.update('edited', 'rev-1', 'normal-1'),
        '/comments.update',
      ],
    ])('refetches the shared comment list after %s, so other consumers of the list see the change', async (_name, write, endpoint) => {
      // Arrange: both hooks share one cache, as the page bottom and the
      // inline highlights do on a real page.
      mockListResponse([buildRow('normal-1')]);
      const { result } = renderHook(
        () => ({
          pageComment: useSWRxPageComment('page-1'),
          sharedList: useSWRxCommentList('page-1'),
        }),
        { wrapper },
      );
      await waitFor(() =>
        expect(result.current.sharedList.data).toHaveLength(1),
      );
      mockListResponse([buildRow('normal-1'), inlineRow('inline-1')]);

      // Act
      await act(async () => {
        await write(result.current.pageComment);
      });

      // Assert
      expect(apiPost).toHaveBeenCalledWith(endpoint, expect.anything());
      await waitFor(() =>
        expect(result.current.sharedList.data).toHaveLength(2),
      );
      expect(result.current.pageComment.data?.map((c) => c._id)).toEqual([
        'normal-1',
      ]);
    });
  });
});
