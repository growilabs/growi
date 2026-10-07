// @vitest-environment happy-dom

import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

import type { ICommentListItem } from '~/features/comment/interfaces';

import type { InlineCommentWithReplies } from '../../interfaces';
import { useSWRxInlineComments } from './inline-comment';

// The API boundary is the observable contract: which endpoints are read and
// written, and that a write is followed by the right refetches.
const apiv3Get = vi.fn();
const apiv3Post = vi.fn();
const apiv3Put = vi.fn();
const apiv3Delete = vi.fn();
vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: (...args: unknown[]) => apiv3Get(...args),
  apiv3Post: (...args: unknown[]) => apiv3Post(...args),
  apiv3Put: (...args: unknown[]) => apiv3Put(...args),
  apiv3Delete: (...args: unknown[]) => apiv3Delete(...args),
}));

// Fresh SWR cache per render so array keys don't leak resolved data between tests.
const wrapper = ({ children }: PropsWithChildren): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const createdAt = new Date('2026-01-01T00:00:00.000Z');

const listItem = (
  overrides: Partial<ICommentListItem> = {},
): ICommentListItem => ({
  _id: 'comment1',
  id: 'comment1',
  v: 0,
  __v: 0,
  page: 'page1',
  pageId: 'page1',
  creator: null,
  creatorId: 'user1',
  revision: null,
  revisionId: null,
  replyTo: null,
  replyToId: null,
  comment: 'first comment',
  commentPosition: -1,
  createdAt,
  updatedAt: createdAt,
  isInline: true,
  quote: 'quoted text',
  prefix: '',
  suffix: '',
  approxOffset: 0,
  anchorOriginRevisionId: 'revision1',
  resolvedById: null,
  resolvedAt: null,
  ...overrides,
});

const replyItem = (
  overrides: Partial<ICommentListItem> = {},
): ICommentListItem =>
  listItem({
    _id: 'reply1',
    id: 'reply1',
    creatorId: 'user2',
    comment: 'a reply',
    replyTo: 'comment1',
    replyToId: 'comment1',
    quote: null,
    prefix: null,
    suffix: null,
    approxOffset: null,
    anchorOriginRevisionId: null,
    ...overrides,
  });

const ordinaryItem = (): ICommentListItem =>
  listItem({
    _id: 'ordinary1',
    id: 'ordinary1',
    comment: 'an ordinary comment',
    isInline: false,
    quote: null,
    prefix: null,
    suffix: null,
    approxOffset: null,
    anchorOriginRevisionId: null,
  });

const expectedOrigin = (
  overrides: Partial<InlineCommentWithReplies> = {},
): InlineCommentWithReplies => ({
  id: 'comment1',
  pageId: 'page1',
  creatorId: 'user1',
  creator: null,
  comment: 'first comment',
  anchorOriginRevisionId: 'revision1',
  anchor: { quote: 'quoted text', prefix: '', suffix: '', approxOffset: 0 },
  resolvedById: null,
  resolvedAt: null,
  createdAt,
  updatedAt: createdAt,
  replies: [],
  ...overrides,
});

/**
 * Serves the shared comment list from a queue (the last entry repeats) and an
 * empty page info, so a test can observe which endpoints were refetched.
 */
const serveCommentLists = (...lists: ICommentListItem[][]): void => {
  const queue = [...lists];
  apiv3Get.mockImplementation((endpoint: string) => {
    if (endpoint === '/comments') {
      const comments = queue.length > 1 ? queue.shift() : queue[0];
      return Promise.resolve({ data: { comments } });
    }
    return Promise.resolve({ data: {} });
  });
};

const callsTo = (endpoint: string): unknown[][] =>
  apiv3Get.mock.calls.filter(([calledEndpoint]) => calledEndpoint === endpoint);

beforeEach(() => {
  apiv3Get.mockReset();
  apiv3Post.mockReset();
  apiv3Put.mockReset();
  apiv3Delete.mockReset();
  apiv3Post.mockResolvedValue({
    data: { inlineComment: {}, inlineCommentReply: {} },
  });
  apiv3Put.mockResolvedValue({
    data: { inlineComment: {}, inlineCommentReply: {} },
  });
  apiv3Delete.mockResolvedValue({ data: {} });
});

describe('useSWRxInlineComments', () => {
  it('reads the shared comment list and returns only inline comments, grouped as origins with replies', async () => {
    serveCommentLists([ordinaryItem(), listItem(), replyItem()]);

    const { result } = renderHook(() => useSWRxInlineComments('page1'), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([
        expectedOrigin({
          replies: [
            {
              id: 'reply1',
              pageId: 'page1',
              creatorId: 'user2',
              creator: null,
              comment: 'a reply',
              replyToId: 'comment1',
              createdAt,
              updatedAt: createdAt,
            },
          ],
        }),
      ]);
    });
    expect(apiv3Get).toHaveBeenCalledWith('/comments', { pageId: 'page1' });
    expect(apiv3Get).not.toHaveBeenCalledWith(
      '/inline-comments',
      expect.anything(),
    );
  });

  it('keeps the same data reference across re-renders while the shared list is unchanged', async () => {
    serveCommentLists([listItem()]);

    const { result, rerender } = renderHook(
      () => useSWRxInlineComments('page1'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    const first = result.current.data;
    rerender();
    expect(result.current.data).toBe(first);
  });

  it('does not fetch anything when pageId is null (the share-link view passes null)', async () => {
    serveCommentLists([listItem()]);

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
    apiv3Get.mockImplementation(
      (_endpoint: string, params: { pageId: string }) =>
        Promise.resolve({
          data: {
            comments: [
              listItem({
                _id: `comment-${params.pageId}`,
                id: `comment-${params.pageId}`,
                page: params.pageId,
                pageId: params.pageId,
              }),
            ],
          },
        }),
    );

    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string }) => useSWRxInlineComments(pageId),
      { wrapper, initialProps: { pageId: 'page1' } },
    );
    await waitFor(() =>
      expect(result.current.data?.[0]?.id).toBe('comment-page1'),
    );

    rerender({ pageId: 'page2' });
    await waitFor(() =>
      expect(result.current.data?.[0]?.id).toBe('comment-page2'),
    );
  });

  describe('writes that change the comment count refetch the shared list and the page info', () => {
    it('create()', async () => {
      serveCommentLists([], [listItem()]);
      const { result } = renderHook(() => useSWRxInlineComments('page1'), {
        wrapper,
      });
      await waitFor(() => expect(result.current.data).toEqual([]));

      await act(async () => {
        await result.current.create({
          pageId: 'page1',
          anchorOriginRevisionId: 'revision1',
          comment: 'first comment',
          anchor: { quote: 'q', prefix: '', suffix: '', approxOffset: 0 },
        });
      });

      expect(apiv3Post).toHaveBeenCalledWith(
        '/inline-comments',
        expect.objectContaining({ pageId: 'page1', comment: 'first comment' }),
      );
      expect(callsTo('/comments')).toHaveLength(2);
      expect(apiv3Get).toHaveBeenCalledWith('/page/info', { pageId: 'page1' });
      await waitFor(() =>
        expect(result.current.data).toEqual([expectedOrigin()]),
      );
    });

    it('createReply()', async () => {
      serveCommentLists([listItem()], [listItem(), replyItem()]);
      const { result } = renderHook(() => useSWRxInlineComments('page1'), {
        wrapper,
      });
      await waitFor(() => expect(result.current.data).toHaveLength(1));

      await act(async () => {
        await result.current.createReply('comment1', { comment: 'a reply' });
      });

      expect(apiv3Post).toHaveBeenCalledWith(
        '/inline-comments/comment1/replies',
        { comment: 'a reply' },
      );
      expect(callsTo('/comments')).toHaveLength(2);
      expect(apiv3Get).toHaveBeenCalledWith('/page/info', { pageId: 'page1' });
      await waitFor(() =>
        expect(result.current.data?.[0]?.replies).toHaveLength(1),
      );
    });

    it('remove()', async () => {
      serveCommentLists([listItem()], []);
      const { result } = renderHook(() => useSWRxInlineComments('page1'), {
        wrapper,
      });
      await waitFor(() => expect(result.current.data).toHaveLength(1));

      await act(async () => {
        await result.current.remove('comment1');
      });

      expect(apiv3Delete).toHaveBeenCalledWith('/inline-comments/comment1');
      expect(callsTo('/comments')).toHaveLength(2);
      expect(apiv3Get).toHaveBeenCalledWith('/page/info', { pageId: 'page1' });
      await waitFor(() => expect(result.current.data).toEqual([]));
    });

    it('removeReply()', async () => {
      serveCommentLists([listItem(), replyItem()], [listItem()]);
      const { result } = renderHook(() => useSWRxInlineComments('page1'), {
        wrapper,
      });
      await waitFor(() =>
        expect(result.current.data?.[0]?.replies).toHaveLength(1),
      );

      await act(async () => {
        await result.current.removeReply('reply1');
      });

      expect(apiv3Delete).toHaveBeenCalledWith(
        '/inline-comments/replies/reply1',
      );
      expect(callsTo('/comments')).toHaveLength(2);
      expect(apiv3Get).toHaveBeenCalledWith('/page/info', { pageId: 'page1' });
      await waitFor(() =>
        expect(result.current.data?.[0]?.replies).toEqual([]),
      );
    });
  });

  describe('writes that keep the comment count refetch only the shared list', () => {
    it('resolve()', async () => {
      const resolvedAt = new Date('2026-01-03T00:00:00.000Z');
      serveCommentLists(
        [listItem()],
        [listItem({ resolvedById: 'user1', resolvedAt })],
      );
      const { result } = renderHook(() => useSWRxInlineComments('page1'), {
        wrapper,
      });
      await waitFor(() => expect(result.current.data).toHaveLength(1));

      await act(async () => {
        await result.current.resolve('comment1', true);
      });

      expect(apiv3Put).toHaveBeenCalledWith(
        '/inline-comments/comment1/resolve',
        { resolved: true },
      );
      expect(callsTo('/comments')).toHaveLength(2);
      expect(callsTo('/page/info')).toHaveLength(0);
      await waitFor(() =>
        expect(result.current.data?.[0]?.resolvedAt).toEqual(resolvedAt),
      );
    });

    it('update()', async () => {
      serveCommentLists(
        [listItem()],
        [listItem({ comment: 'edited comment' })],
      );
      const { result } = renderHook(() => useSWRxInlineComments('page1'), {
        wrapper,
      });
      await waitFor(() => expect(result.current.data).toHaveLength(1));

      await act(async () => {
        await result.current.update('comment1', 'edited comment');
      });

      expect(apiv3Put).toHaveBeenCalledWith('/inline-comments/comment1', {
        comment: 'edited comment',
      });
      expect(callsTo('/comments')).toHaveLength(2);
      expect(callsTo('/page/info')).toHaveLength(0);
      await waitFor(() =>
        expect(result.current.data?.[0]?.comment).toBe('edited comment'),
      );
    });

    it('updateReply()', async () => {
      serveCommentLists(
        [listItem(), replyItem()],
        [listItem(), replyItem({ comment: 'edited reply' })],
      );
      const { result } = renderHook(() => useSWRxInlineComments('page1'), {
        wrapper,
      });
      await waitFor(() =>
        expect(result.current.data?.[0]?.replies).toHaveLength(1),
      );

      await act(async () => {
        await result.current.updateReply('reply1', 'edited reply');
      });

      expect(apiv3Put).toHaveBeenCalledWith('/inline-comments/replies/reply1', {
        comment: 'edited reply',
      });
      expect(callsTo('/comments')).toHaveLength(2);
      expect(callsTo('/page/info')).toHaveLength(0);
      await waitFor(() =>
        expect(result.current.data?.[0]?.replies[0]?.comment).toBe(
          'edited reply',
        ),
      );
    });
  });
});
