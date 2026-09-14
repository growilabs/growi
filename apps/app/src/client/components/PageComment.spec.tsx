/**
 * `PageComment` merges two kinds of comments into a single list
 * (Requirement 13.1, 13.2 / design.md 決定3).
 *
 * What this file pins is the *order* of the list's children: the normal
 * comments (origin comments only — replies stay nested under their parent)
 * and the inline comments interleaved by posting date, ascending.
 *
 * The fixtures are deliberately built so that chronological order differs
 * from BOTH the insertion order and a type-grouped order. That matters
 * because `createdAt` is declared as `Date` but actually arrives as an ISO
 * string, and subtracting two strings yields `NaN` — a comparator returning
 * `NaN` leaves the array essentially as inserted, so a test whose expected
 * order happened to equal the insertion order would pass against a broken
 * sort.
 *
 * The two list-item components are stubbed: this component's own contract is
 * which items it renders and in what order, not how each item paints itself
 * (`Comment.spec.tsx` / `InlineCommentItem.spec.tsx` own that).
 */

import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InlineCommentWithReplies } from '../../features/inline-comment/interfaces';
import type {
  ICommentHasId,
  ICommentHasIdList,
} from '../../interfaces/comment';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const commentStore = vi.hoisted(() => ({
  data: undefined as unknown[] | undefined,
}));

/**
 * The comment-list and page-info revalidations, plus the delete request
 * itself: these are what `onDeleteConfirmed` — the callback that replaced the
 * page-level delete modal — is responsible for.
 */
const mutateComments = vi.hoisted(() => vi.fn());
const mutatePageInfo = vi.hoisted(() => vi.fn());
const apiPostMock = vi.hoisted(() => vi.fn(async () => undefined));
const toastErrorMock = vi.hoisted(() => vi.fn());
/** Promises returned by `onDeleteConfirmed`, so a test can await/inspect them. */
const deleteResults = vi.hoisted(() => [] as Promise<void>[]);

vi.mock('./PageComment.module.scss', () => ({
  default: { 'page-comment-styles': 'page-comment-styles' },
}));

vi.mock('~/stores/comment', () => ({
  useSWRxPageComment: () => ({
    data: commentStore.data,
    mutate: mutateComments,
  }),
}));
vi.mock('~/stores/page', () => ({
  useSWRMUTxPageInfo: () => ({ trigger: mutatePageInfo }),
}));
vi.mock('~/client/util/apiv1-client', () => ({
  apiPost: apiPostMock,
}));
vi.mock('~/client/util/toastr', () => ({
  toastError: toastErrorMock,
}));
vi.mock('~/stores/renderer', () => ({
  useCommentForCurrentPageOptions: () => ({ data: undefined }),
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@growi/ui/dist/components', () => ({
  UserPicture: () => <span data-testid="user-picture" />,
}));

/**
 * The item is stubbed, but its stub exposes `onDeleteConfirmed` as a button:
 * that callback is this component's own contract (it owns the delete request
 * and the revalidations that follow), and the only way to exercise it is
 * through the item it is handed to.
 */
vi.mock('./PageComment/Comment', () => ({
  Comment: ({
    comment,
    onDeleteConfirmed,
  }: {
    comment: ICommentHasId;
    onDeleteConfirmed: (comment: ICommentHasId) => Promise<void>;
  }) => (
    <div data-testid="normal-comment" data-comment-id={comment._id}>
      <button
        type="button"
        data-testid={`confirm-delete-${comment._id}`}
        onClick={() => {
          const result = onDeleteConfirmed(comment);
          deleteResults.push(result);
          // A rejection is asserted through `deleteResults`; this only keeps
          // Node from flagging it as unhandled in the meantime.
          result.catch(() => undefined);
        }}
      >
        delete
      </button>
    </div>
  ),
}));
vi.mock('./PageComment/ReplyComments', () => ({
  ReplyComments: ({ replyList }: { replyList: ICommentHasIdList }) => (
    <div
      data-testid="reply-comments"
      data-reply-ids={replyList.map((r) => r._id).join(',')}
    />
  ),
}));
vi.mock('./PageComment/CommentEditor', () => ({
  CommentEditor: () => <div data-testid="comment-editor" />,
}));
vi.mock('./NotAvailableForGuest', () => ({
  NotAvailableForGuest: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('./NotAvailableForReadOnlyUser', () => ({
  NotAvailableIfReadOnlyUserNotAllowedToComment: ({
    children,
  }: {
    children: ReactNode;
  }) => <>{children}</>,
}));

vi.mock(
  '~/features/inline-comment/client/components/InlineCommentItem/InlineCommentItem',
  () => ({
    InlineCommentItem: ({ comment }: { comment: InlineCommentWithReplies }) => (
      <div data-testid="inline-comment" data-comment-id={comment.id} />
    ),
  }),
);

import { PageComment } from './PageComment';

// ---------------------------------------------------------------------------
// Fixtures
//
// `createdAt` is written as an ISO *string* on purpose — that is what the API
// actually returns, despite both interfaces declaring `Date`.
// ---------------------------------------------------------------------------

const normalComment = (
  id: string,
  createdAt: string,
  replyTo?: string,
): ICommentHasId =>
  ({
    _id: id,
    __v: 0,
    page: 'page1',
    creator: 'user1',
    revision: 'revision1',
    comment: `body of ${id}`,
    commentPosition: 0,
    replyTo,
    createdAt,
    updatedAt: createdAt,
  }) as unknown as ICommentHasId;

const inlineComment = (
  id: string,
  createdAt: string,
): InlineCommentWithReplies =>
  ({
    id,
    pageId: 'page1',
    creatorId: 'user1',
    creator: null,
    comment: `body of ${id}`,
    anchorOriginRevisionId: 'revision1',
    anchor: { quote: 'q', prefix: '', suffix: '', approxOffset: 0 },
    resolvedById: null,
    resolvedAt: null,
    createdAt,
    updatedAt: createdAt,
    replies: [],
  }) as unknown as InlineCommentWithReplies;

const resolveInlineComment = vi.fn(async () => undefined);
const createInlineCommentReply = vi.fn(async () => undefined);
const updateInlineComment = vi.fn(async () => undefined);
const removeInlineComment = vi.fn(async () => undefined);
const updateInlineCommentReply = vi.fn(async () => undefined);
const removeInlineCommentReply = vi.fn(async () => undefined);

const renderPageComment = (inlineComments: InlineCommentWithReplies[] = []) =>
  render(
    <PageComment
      // biome-ignore lint/suspicious/noExplicitAny: RevisionRenderer is not exercised here
      rendererOptions={{} as any}
      pageId="page1"
      pagePath="/path/to/page"
      revision="revision1"
      currentUser={{ username: 'alice' }}
      isReadOnly={true}
      inlineComments={{
        comments: inlineComments,
        resolve: resolveInlineComment,
        createReply: createInlineCommentReply,
        update: updateInlineComment,
        remove: removeInlineComment,
        updateReply: updateInlineCommentReply,
        removeReply: removeInlineCommentReply,
        scrollToRange: vi.fn(() => true),
      }}
    />,
  );

/** The ids of every list item, in DOM order, regardless of its kind. */
const renderedItemIds = (container: HTMLElement): string[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>(
      '.page-comments-list [data-comment-id]',
    ),
  ).map((el) => el.dataset.commentId ?? '');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PageComment — one list holding both kinds of comment', () => {
  beforeEach(() => {
    commentStore.data = undefined;
  });

  it('orders normal and inline comments by posting date, not by insertion or kind', () => {
    // `/comments.get` answers newest-first.
    commentStore.data = [
      normalComment('normal-late', '2024-01-03T00:00:00.000Z'),
      normalComment('normal-early', '2024-01-01T00:00:00.000Z'),
    ];

    const { container } = renderPageComment([
      inlineComment('inline-middle', '2024-01-02T00:00:00.000Z'),
    ]);

    expect(renderedItemIds(container)).toEqual([
      'normal-early',
      'inline-middle',
      'normal-late',
    ]);
  });

  it('sorts by the parsed date even when several inline comments arrive out of order', () => {
    commentStore.data = [normalComment('normal-1', '2024-01-02T00:00:00.000Z')];

    const { container } = renderPageComment([
      inlineComment('inline-last', '2024-01-04T00:00:00.000Z'),
      inlineComment('inline-first', '2024-01-01T00:00:00.000Z'),
      inlineComment('inline-third', '2024-01-03T00:00:00.000Z'),
    ]);

    expect(renderedItemIds(container)).toEqual([
      'inline-first',
      'normal-1',
      'inline-third',
      'inline-last',
    ]);
  });

  it('renders inline comments even when the page has no normal comments', () => {
    commentStore.data = [];

    const { container } = renderPageComment([
      inlineComment('inline-only', '2024-01-01T00:00:00.000Z'),
    ]);

    expect(renderedItemIds(container)).toEqual(['inline-only']);
  });

  it('keeps replies nested under their parent instead of mixing them into the list', () => {
    commentStore.data = [
      // newest-first, as the API returns it
      normalComment('reply-2', '2024-01-05T00:00:00.000Z', 'normal-origin'),
      normalComment('reply-1', '2024-01-03T00:00:00.000Z', 'normal-origin'),
      normalComment('normal-origin', '2024-01-01T00:00:00.000Z'),
    ];

    const { container } = renderPageComment([
      inlineComment('inline-late', '2024-01-04T00:00:00.000Z'),
    ]);

    // Replies are not list items of their own.
    expect(renderedItemIds(container)).toEqual([
      'normal-origin',
      'inline-late',
    ]);

    // ...and they stay oldest-first under their parent.
    const replies = container.querySelector<HTMLElement>(
      '[data-testid="reply-comments"]',
    );
    expect(replies?.dataset.replyIds).toBe('reply-1,reply-2');
  });

  it('renders the normal comments alone when no inline comments are supplied', () => {
    // The shape callers that must never show inline comments use: the
    // share-link view and the search-result preview omit the prop entirely.
    commentStore.data = [normalComment('normal-1', '2024-01-01T00:00:00.000Z')];

    const { container } = render(
      <PageComment
        // biome-ignore lint/suspicious/noExplicitAny: RevisionRenderer is not exercised here
        rendererOptions={{} as any}
        pageId="page1"
        pagePath="/path/to/page"
        revision="revision1"
        currentUser={{ username: 'alice' }}
        isReadOnly={true}
      />,
    );

    expect(renderedItemIds(container)).toEqual(['normal-1']);
    expect(
      container.querySelector('[data-testid="inline-comment"]'),
    ).toBeNull();
  });

  it('renders nothing when there is neither a normal nor an inline comment', () => {
    commentStore.data = [];

    const { container } = renderPageComment([]);

    expect(container.querySelector('.page-comments-list')).toBeNull();
  });
});

/**
 * The delete request used to live behind a page-level modal whose open state
 * this component owned; it is now a per-comment callback the item calls once
 * its own inline confirmation is confirmed (design.md: 削除確認UIの共通化).
 * What stays this component's own contract is the request itself and the two
 * revalidations that must follow it.
 */
describe('PageComment — onDeleteConfirmed', () => {
  beforeEach(() => {
    commentStore.data = undefined;
    deleteResults.length = 0;
    apiPostMock.mockResolvedValue(undefined);
  });

  it('removes the confirmed comment and revalidates the list and the page info', async () => {
    commentStore.data = [normalComment('normal-1', '2024-01-01T00:00:00.000Z')];

    const { container } = renderPageComment();

    await userEvent.click(
      container.querySelector<HTMLElement>(
        '[data-testid="confirm-delete-normal-1"]',
      ) as HTMLElement,
    );
    await Promise.all(deleteResults);

    expect(apiPostMock).toHaveBeenCalledWith('/comments.remove', {
      comment_id: 'normal-1',
    });
    expect(mutateComments).toHaveBeenCalled();
    expect(mutatePageInfo).toHaveBeenCalled();
  });

  it('surfaces a failed delete as a toast and rejects, so the item can report it in place', async () => {
    commentStore.data = [normalComment('normal-1', '2024-01-01T00:00:00.000Z')];
    apiPostMock.mockRejectedValue(new Error('deletion refused'));

    const { container } = renderPageComment();

    await userEvent.click(
      container.querySelector<HTMLElement>(
        '[data-testid="confirm-delete-normal-1"]',
      ) as HTMLElement,
    );

    await expect(deleteResults[0]).rejects.toThrow('deletion refused');
    expect(toastErrorMock).toHaveBeenCalledWith('deletion refused');
  });
});
