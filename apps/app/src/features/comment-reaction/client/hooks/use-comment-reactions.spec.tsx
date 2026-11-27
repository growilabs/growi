// @vitest-environment happy-dom

import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { mock } from 'vitest-mock-extended';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';
import type { ICommentListItem } from '~/features/comment/interfaces';
import { useShareLinkId } from '~/states/page/hooks';

import type { ReactionChip, ReactionKey } from '../../interfaces';
import { useCommentReactions } from './use-comment-reactions';

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: vi.fn(),
  apiv3Put: vi.fn(),
}));
vi.mock('~/client/util/toastr', () => ({ toastError: vi.fn() }));
vi.mock('~/states/page/hooks', () => ({ useShareLinkId: vi.fn() }));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const wrapper = ({ children }: PropsWithChildren): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const THUMBS_UP = 'unicode:+1' as ReactionKey;
const HEART = 'unicode:heart' as ReactionKey;

const chip = (emoji: ReactionKey, count = 1): ReactionChip => ({
  emoji,
  count,
  reactedByMe: false,
  users: [],
});

const commentItem = (
  id: string,
  overrides: Partial<ICommentListItem> = {},
): ICommentListItem => ({
  _id: id,
  id,
  v: 0,
  __v: 0,
  page: 'page1',
  pageId: 'page1',
  creator: null,
  creatorId: null,
  revision: null,
  revisionId: null,
  replyTo: null,
  replyToId: null,
  comment: `body of ${id}`,
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
  reactions: [],
  ...overrides,
});

type GetResponse = Awaited<ReturnType<typeof apiv3Get>>;
type PutResponse = Awaited<ReturnType<typeof apiv3Put>>;

const getResponse = (comments: ICommentListItem[]): GetResponse => {
  const response = mock<GetResponse>();
  response.data = { comments };
  return response;
};

const putResponse = (comment: ICommentListItem): PutResponse => {
  const response = mock<PutResponse>();
  response.data = { changed: true, comment };
  return response;
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const initialList = (): ICommentListItem[] => [
  commentItem('c1', { reactions: [chip(THUMBS_UP)] }),
  commentItem('c2', { reactions: [chip(HEART, 2)] }),
  commentItem('c3', { reactions: null }),
];

const renderLoaded = async (commentId: string) => {
  const rendered = renderHook(() => useCommentReactions('page1', commentId), {
    wrapper,
  });
  await waitFor(() =>
    expect(rendered.result.current.chips).not.toBeUndefined(),
  );
  return rendered;
};

describe('useCommentReactions', () => {
  beforeEach(() => {
    vi.mocked(apiv3Get).mockReset();
    vi.mocked(apiv3Put).mockReset();
    vi.mocked(toastError).mockReset();
    vi.mocked(useShareLinkId).mockReset();
    vi.mocked(useShareLinkId).mockReturnValue(undefined);
    vi.mocked(apiv3Get).mockResolvedValue(getResponse(initialList()));
  });

  describe('reading chips from the comment list cache', () => {
    it('is undefined while the list is loading', () => {
      vi.mocked(apiv3Get).mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useCommentReactions('page1', 'c1'), {
        wrapper,
      });

      expect(result.current.chips).toBeUndefined();
    });

    it("returns the target comment's chips without an extra fetch", async () => {
      const { result } = await renderLoaded('c1');

      expect(result.current.chips).toEqual([chip(THUMBS_UP)]);
      expect(apiv3Get).toHaveBeenCalledTimes(1);
      expect(apiv3Get).toHaveBeenCalledWith('/comments', { pageId: 'page1' });
    });

    it('returns null, distinct from loading, when the server could not load reactions', async () => {
      const { result } = await renderLoaded('c3');

      expect(result.current.chips).toBeNull();
    });

    it('returns null when the comment is not in the loaded list', async () => {
      const { result } = renderHook(
        () => useCommentReactions('page1', 'gone'),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result.current.chips).toBeNull());
    });
  });

  describe('lookup cost with many comments', () => {
    it('does not rescan the whole list for every comment on a render', async () => {
      const COUNT = 30;
      let idReads = 0;
      const countingItem = (id: string): ICommentListItem => {
        const item = commentItem(id, { reactions: [chip(THUMBS_UP)] });
        return Object.defineProperty(item, 'id', {
          enumerable: true,
          get: () => {
            idReads += 1;
            return id;
          },
        });
      };
      const ids = Array.from({ length: COUNT }, (_, i) => `c${i}`);
      vi.mocked(apiv3Get).mockResolvedValue(getResponse(ids.map(countingItem)));

      const { result, rerender } = renderHook(
        () => ids.map((id) => useCommentReactions('page1', id).chips),
        { wrapper },
      );
      await waitFor(() => expect(result.current[0]).not.toBeUndefined());
      expect(result.current[COUNT - 1]).toEqual([chip(THUMBS_UP)]);

      idReads = 0;
      rerender();

      // a per-comment linear scan would read about COUNT^2 / 2 ids here
      expect(idReads).toBeLessThanOrEqual(COUNT);
      expect(result.current[COUNT - 1]).toEqual([chip(THUMBS_UP)]);
    });
  });

  describe('setReaction on success', () => {
    it('sends the explicit add request and replaces only the target comment, without refetching', async () => {
      const { result } = await renderLoaded('c1');
      const updated = commentItem('c1', {
        comment: 'newer body',
        reactions: [chip(THUMBS_UP), chip(HEART)],
      });
      vi.mocked(apiv3Put).mockResolvedValue(putResponse(updated));

      await act(async () => {
        await result.current.setReaction(HEART, true);
      });

      expect(apiv3Put).toHaveBeenCalledWith('/comments/c1/reactions', {
        emoji: HEART,
        isReacted: true,
      });
      expect(result.current.chips).toEqual([chip(THUMBS_UP), chip(HEART)]);
      expect(apiv3Get).toHaveBeenCalledTimes(1);
      expect(toastError).not.toHaveBeenCalled();
    });

    it('sends the explicit remove request', async () => {
      const { result } = await renderLoaded('c1');
      vi.mocked(apiv3Put).mockResolvedValue(
        putResponse(commentItem('c1', { reactions: [] })),
      );

      await act(async () => {
        await result.current.setReaction(THUMBS_UP, false);
      });

      expect(apiv3Put).toHaveBeenCalledWith('/comments/c1/reactions', {
        emoji: THUMBS_UP,
        isReacted: false,
      });
      expect(result.current.chips).toEqual([]);
    });

    it('leaves the other comments in the list unchanged', async () => {
      const target = renderHook(
        () => ({
          c1: useCommentReactions('page1', 'c1'),
          c2: useCommentReactions('page1', 'c2'),
          c3: useCommentReactions('page1', 'c3'),
        }),
        { wrapper },
      );
      await waitFor(() => expect(target.result.current.c2.chips).toBeDefined());
      const c2Before = target.result.current.c2.chips;
      vi.mocked(apiv3Put).mockResolvedValue(
        putResponse(commentItem('c1', { reactions: [] })),
      );

      await act(async () => {
        await target.result.current.c1.setReaction(THUMBS_UP, false);
      });

      expect(target.result.current.c1.chips).toEqual([]);
      expect(target.result.current.c2.chips).toBe(c2Before);
      expect(target.result.current.c3.chips).toBeNull();
    });

    it('does not insert the response comment when it is not in the cached list', async () => {
      const { result } = renderHook(
        () => useCommentReactions('page1', 'gone'),
        {
          wrapper,
        },
      );
      await waitFor(() => expect(result.current.chips).toBeNull());
      vi.mocked(apiv3Put).mockResolvedValue(
        putResponse(commentItem('gone', { reactions: [chip(HEART)] })),
      );

      await act(async () => {
        await result.current.setReaction(HEART, true);
      });

      expect(result.current.chips).toBeNull();
      expect(apiv3Get).toHaveBeenCalledTimes(1);
    });

    it('refetches the list without replacing or showing an error when the response reactions are null', async () => {
      const { result } = await renderLoaded('c1');
      const refreshed = [
        commentItem('c1', { reactions: [chip(THUMBS_UP), chip(HEART)] }),
        commentItem('c2'),
      ];
      vi.mocked(apiv3Get).mockResolvedValue(getResponse(refreshed));
      vi.mocked(apiv3Put).mockResolvedValue(
        putResponse(commentItem('c1', { reactions: null })),
      );

      await act(async () => {
        await result.current.setReaction(HEART, true);
      });

      expect(apiv3Get).toHaveBeenCalledTimes(2);
      expect(result.current.chips).toEqual([chip(THUMBS_UP), chip(HEART)]);
      expect(toastError).not.toHaveBeenCalled();
    });
  });

  it('shows no error and does not reject when the response reactions are null and the refetch fails', async () => {
    const { result } = await renderLoaded('c1');
    vi.mocked(apiv3Get).mockRejectedValue(new Error('Network Error'));
    vi.mocked(apiv3Put).mockResolvedValue(
      putResponse(commentItem('c1', { reactions: null })),
    );

    await act(async () => {
      await expect(
        result.current.setReaction(HEART, true),
      ).resolves.toBeUndefined();
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(result.current.chips).toEqual([chip(THUMBS_UP)]);
  });

  describe('setReaction on failure', () => {
    it.each([
      [
        '409 kind limit',
        [{ code: 'reaction-kind-limit-exceeded' }],
        'comment_reaction.kind_limit_reached',
      ],
      [
        '404 not found',
        [{ code: 'notfound_or_forbidden' }],
        'comment_reaction.comment_unavailable',
      ],
      [
        'other API error',
        [{ code: 'validation_failed' }],
        'comment_reaction.update_failed',
      ],
      [
        'network failure',
        new Error('Network Error'),
        'comment_reaction.update_failed',
      ],
    ])('%s: keeps the cache until the refetch, toasts the matching message, refetches and does not reject', async (_label, rejection, expectedMessage) => {
      const { result } = await renderLoaded('c1');
      const refetch = deferred<GetResponse>();
      vi.mocked(apiv3Get).mockReturnValue(refetch.promise);
      vi.mocked(apiv3Put).mockRejectedValue(rejection);

      let settled: Promise<void>;
      act(() => {
        settled = result.current.setReaction(HEART, true);
      });

      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
      expect(toastError).toHaveBeenCalledWith(expectedMessage);
      expect(result.current.chips).toEqual([chip(THUMBS_UP)]);
      expect(result.current.isUpdating).toBe(true);
      await waitFor(() => expect(apiv3Get).toHaveBeenCalledTimes(2));

      const latest = [
        commentItem('c1', { reactions: [chip(THUMBS_UP), chip(HEART)] }),
      ];
      await act(async () => {
        refetch.resolve(getResponse(latest));
        await expect(settled).resolves.toBeUndefined();
      });

      expect(result.current.chips).toEqual([chip(THUMBS_UP), chip(HEART)]);
      expect(result.current.isUpdating).toBe(false);
    });

    it('keeps the pre-operation display when the refetch also fails', async () => {
      const { result } = await renderLoaded('c1');
      vi.mocked(apiv3Get).mockRejectedValue(new Error('Network Error'));
      vi.mocked(apiv3Put).mockRejectedValue([
        { code: 'reaction-kind-limit-exceeded' },
      ]);

      await act(async () => {
        await expect(
          result.current.setReaction(HEART, true),
        ).resolves.toBeUndefined();
      });

      expect(apiv3Get).toHaveBeenCalledTimes(2);
      expect(result.current.chips).toEqual([chip(THUMBS_UP)]);
      expect(result.current.isUpdating).toBe(false);
    });
  });

  describe('isUpdating', () => {
    it('is true while the request is in flight and false after it completes', async () => {
      const { result } = await renderLoaded('c1');
      const request = deferred<PutResponse>();
      vi.mocked(apiv3Put).mockReturnValue(request.promise);
      expect(result.current.isUpdating).toBe(false);

      let settled: Promise<void>;
      act(() => {
        settled = result.current.setReaction(HEART, true);
      });
      expect(result.current.isUpdating).toBe(true);

      await act(async () => {
        request.resolve(putResponse(commentItem('c1', { reactions: [] })));
        await settled;
      });
      expect(result.current.isUpdating).toBe(false);
    });
  });
});
