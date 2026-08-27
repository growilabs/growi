// @vitest-environment happy-dom

import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

import type { InlineCommentWithReplies } from '../../interfaces';
import type {
  CreateInlineCommentReplyResponseBody,
  CreateInlineCommentResponseBody,
  ListInlineCommentsResponseBody,
  ResolveInlineCommentResponseBody,
} from '../../interfaces/dto';
import { useSWRxInlineComments } from './inline-comment';

// Mock the API boundary — the contract under test is "list/create/createReply/
// resolve talk to apiv3Get/apiv3Post/apiv3Put and a write causes the list to
// be refetched", not any SWR internals.
const apiv3Get = vi.fn();
const apiv3Post = vi.fn();
const apiv3Put = vi.fn();
vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: (...args: unknown[]) => apiv3Get(...args),
  apiv3Post: (...args: unknown[]) => apiv3Post(...args),
  apiv3Put: (...args: unknown[]) => apiv3Put(...args),
}));

// Fresh SWR cache per render so array keys don't leak resolved data between tests.
const wrapper = ({ children }: PropsWithChildren): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const originComment = (
  overrides: Partial<InlineCommentWithReplies> = {},
): InlineCommentWithReplies => ({
  id: 'comment1',
  pageId: 'page1',
  creatorId: 'user1',
  comment: 'first comment',
  anchorOriginRevisionId: 'revision1',
  anchor: { quote: 'quoted text', prefix: '', suffix: '', approxOffset: 0 },
  resolvedById: null,
  resolvedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  replies: [],
  ...overrides,
});

beforeEach(() => {
  apiv3Get.mockReset();
  apiv3Post.mockReset();
  apiv3Put.mockReset();
});

describe('useSWRxInlineComments', () => {
  it('fetches the page-scoped list via apiv3Get, keyed by pageId', async () => {
    const list = [originComment()];
    apiv3Get.mockResolvedValue({
      data: { inlineComments: list } satisfies ListInlineCommentsResponseBody,
    });

    const { result } = renderHook(() => useSWRxInlineComments('page1'), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(list);
    });
    expect(apiv3Get).toHaveBeenCalledWith('/inline-comments', {
      pageId: 'page1',
    });
  });

  it('does not fetch when pageId is null', async () => {
    const { result } = renderHook(() => useSWRxInlineComments(null), {
      wrapper,
    });

    // Give SWR a tick to (not) issue a fetch.
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiv3Get).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('keys the list by pageId, so switching pages fetches and returns a different list', async () => {
    const listForPage1 = [originComment({ id: 'comment1', pageId: 'page1' })];
    const listForPage2 = [originComment({ id: 'comment2', pageId: 'page2' })];
    apiv3Get.mockImplementation(
      (_endpoint: string, params: { pageId: string }) =>
        Promise.resolve({
          data: {
            inlineComments:
              params.pageId === 'page1' ? listForPage1 : listForPage2,
          } satisfies ListInlineCommentsResponseBody,
        }),
    );

    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string }) => useSWRxInlineComments(pageId),
      { wrapper, initialProps: { pageId: 'page1' } },
    );
    await waitFor(() => expect(result.current.data).toEqual(listForPage1));

    rerender({ pageId: 'page2' });
    await waitFor(() => expect(result.current.data).toEqual(listForPage2));

    expect(apiv3Get).toHaveBeenCalledWith('/inline-comments', {
      pageId: 'page1',
    });
    expect(apiv3Get).toHaveBeenCalledWith('/inline-comments', {
      pageId: 'page2',
    });
  });

  it('revalidates the list after create() succeeds', async () => {
    const firstList = [originComment()];
    const secondList = [originComment(), originComment({ id: 'comment2' })];
    apiv3Get
      .mockResolvedValueOnce({
        data: {
          inlineComments: firstList,
        } satisfies ListInlineCommentsResponseBody,
      })
      .mockResolvedValueOnce({
        data: {
          inlineComments: secondList,
        } satisfies ListInlineCommentsResponseBody,
      });
    apiv3Post.mockResolvedValue({
      data: {
        inlineComment: originComment({ id: 'comment2' }),
      } satisfies CreateInlineCommentResponseBody,
    });

    const { result } = renderHook(() => useSWRxInlineComments('page1'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual(firstList));

    await act(async () => {
      await result.current.create({
        pageId: 'page1',
        anchorOriginRevisionId: 'revision1',
        comment: 'second comment',
        anchor: { quote: 'q', prefix: '', suffix: '', approxOffset: 0 },
      });
    });

    expect(apiv3Post).toHaveBeenCalledWith(
      '/inline-comments',
      expect.objectContaining({ pageId: 'page1', comment: 'second comment' }),
    );
    // The defining behavior under test: a write is followed by a refetch of
    // the SAME list — not merely that the POST succeeded.
    expect(apiv3Get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.data).toEqual(secondList));
  });

  it('revalidates the list after createReply() succeeds', async () => {
    const firstList = [originComment()];
    const secondList = [
      originComment({
        replies: [
          {
            id: 'reply1',
            pageId: 'page1',
            creatorId: 'user2',
            comment: 'a reply',
            replyToId: 'comment1',
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ],
      }),
    ];
    apiv3Get
      .mockResolvedValueOnce({
        data: {
          inlineComments: firstList,
        } satisfies ListInlineCommentsResponseBody,
      })
      .mockResolvedValueOnce({
        data: {
          inlineComments: secondList,
        } satisfies ListInlineCommentsResponseBody,
      });
    apiv3Post.mockResolvedValue({
      data: {
        inlineCommentReply: secondList[0].replies[0],
      } satisfies CreateInlineCommentReplyResponseBody,
    });

    const { result } = renderHook(() => useSWRxInlineComments('page1'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual(firstList));

    await act(async () => {
      await result.current.createReply('comment1', { comment: 'a reply' });
    });

    expect(apiv3Post).toHaveBeenCalledWith(
      '/inline-comments/comment1/replies',
      {
        comment: 'a reply',
      },
    );
    expect(apiv3Get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.data).toEqual(secondList));
  });

  it('revalidates the list after resolve() succeeds', async () => {
    const firstList = [originComment()];
    const resolved = originComment({
      resolvedById: 'user1',
      resolvedAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    const secondList = [resolved];
    apiv3Get
      .mockResolvedValueOnce({
        data: {
          inlineComments: firstList,
        } satisfies ListInlineCommentsResponseBody,
      })
      .mockResolvedValueOnce({
        data: {
          inlineComments: secondList,
        } satisfies ListInlineCommentsResponseBody,
      });
    apiv3Put.mockResolvedValue({
      data: {
        inlineComment: resolved,
      } satisfies ResolveInlineCommentResponseBody,
    });

    const { result } = renderHook(() => useSWRxInlineComments('page1'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual(firstList));

    await act(async () => {
      await result.current.resolve('comment1', true);
    });

    expect(apiv3Put).toHaveBeenCalledWith('/inline-comments/comment1/resolve', {
      resolved: true,
    });
    expect(apiv3Get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.data).toEqual(secondList));
  });
});
