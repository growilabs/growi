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
import { render, screen, within } from '@testing-library/react';
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
// The real list menu translates its own labels through react-i18next.
vi.mock('react-i18next', () => ({
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
    InlineCommentItem: ({
      comment,
      collapsed,
      onExpand,
      onCollapse,
      resolve,
    }: {
      comment: InlineCommentWithReplies;
      collapsed: boolean;
      onExpand: () => void;
      onCollapse: () => void;
      resolve: (id: string, resolved: boolean) => Promise<unknown>;
    }) => (
      <div
        data-testid="inline-comment"
        data-comment-id={comment.id}
        data-collapsed={String(collapsed)}
      >
        <button type="button" onClick={onExpand}>
          {`expand ${comment.id}`}
        </button>
        <button type="button" onClick={onCollapse}>
          {`collapse ${comment.id}`}
        </button>
        <button
          type="button"
          onClick={() => {
            // Flip the resolved state, as the real item's toggle does.
            resolve(comment.id, comment.resolvedAt == null).catch(
              () => undefined,
            );
          }}
        >
          {`toggle-resolved ${comment.id}`}
        </button>
      </div>
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
  resolvedAt: string | null = null,
): InlineCommentWithReplies =>
  ({
    id,
    pageId: 'page1',
    creatorId: 'user1',
    creator: null,
    comment: `body of ${id}`,
    anchorOriginRevisionId: 'revision1',
    anchor: { quote: 'q', prefix: '', suffix: '', approxOffset: 0 },
    resolvedById: resolvedAt == null ? null : 'user1',
    resolvedAt,
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

const pageCommentElement = (
  inlineComments: InlineCommentWithReplies[] = [],
  isReadOnly = true,
) => (
  <PageComment
    // biome-ignore lint/suspicious/noExplicitAny: RevisionRenderer is not exercised here
    rendererOptions={{} as any}
    pageId="page1"
    pagePath="/path/to/page"
    revision="revision1"
    currentUser={{ username: 'alice' }}
    isReadOnly={isReadOnly}
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
  />
);

const renderPageComment = (
  inlineComments: InlineCommentWithReplies[] = [],
  isReadOnly = true,
) => render(pageCommentElement(inlineComments, isReadOnly));

const LIST_MENU_LABEL = 'inline_comment.list_menu';
const EXPAND_ALL_LABEL = 'inline_comment.expand_all_resolved';

const collapsedStateOf = (container: HTMLElement, id: string): string | null =>
  container
    .querySelector<HTMLElement>(
      `[data-testid="inline-comment"][data-comment-id="${id}"]`,
    )
    ?.getAttribute('data-collapsed') ?? null;

const openListMenu = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: LIST_MENU_LABEL }));
};

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

/**
 * Resolved inline comments start folded, and the list-level menu can unfold
 * them all (Requirement 20, 21.2, 22). Normal comments are never folded. The
 * item is stubbed, so what is pinned here is what the list hands each item
 * (`collapsed`, `onExpand`, `onCollapse`, the wrapped `resolve`) and what the
 * menu does, observed through the item stub's `data-collapsed`.
 */
describe('PageComment — folding resolved inline comments', () => {
  const resolvedAt = '2024-02-01T00:00:00.000Z';

  beforeEach(() => {
    commentStore.data = [];
    resolveInlineComment.mockReset();
    resolveInlineComment.mockResolvedValue(undefined);
  });

  it('folds resolved inline comments by default and leaves unresolved and normal comments open (Requirement 20.1, 20.3)', () => {
    commentStore.data = [normalComment('normal-1', '2024-01-01T00:00:00.000Z')];

    const { container } = renderPageComment([
      inlineComment('resolved-1', '2024-01-02T00:00:00.000Z', resolvedAt),
      inlineComment('open-1', '2024-01-03T00:00:00.000Z'),
    ]);

    expect(collapsedStateOf(container, 'resolved-1')).toBe('true');
    expect(collapsedStateOf(container, 'open-1')).toBe('false');
    expect(
      container
        .querySelector('[data-testid="normal-comment"]')
        ?.hasAttribute('data-collapsed'),
    ).toBe(false);
  });

  it('expands only the comment whose expand operation was used, and folds it again on collapse (Requirement 21.2)', async () => {
    const { container } = renderPageComment([
      inlineComment('resolved-1', '2024-01-01T00:00:00.000Z', resolvedAt),
      inlineComment('resolved-2', '2024-01-02T00:00:00.000Z', resolvedAt),
    ]);

    await userEvent.click(screen.getByText('expand resolved-1'));

    expect(collapsedStateOf(container, 'resolved-1')).toBe('false');
    expect(collapsedStateOf(container, 'resolved-2')).toBe('true');

    await userEvent.click(screen.getByText('collapse resolved-1'));

    expect(collapsedStateOf(container, 'resolved-1')).toBe('true');
    expect(collapsedStateOf(container, 'resolved-2')).toBe('true');
  });

  it('unfolds every resolved inline comment from the list menu and nothing else (Requirement 22.3, 22.4)', async () => {
    const { container } = renderPageComment([
      inlineComment('resolved-1', '2024-01-01T00:00:00.000Z', resolvedAt),
      inlineComment('open-1', '2024-01-02T00:00:00.000Z'),
      inlineComment('resolved-2', '2024-01-03T00:00:00.000Z', resolvedAt),
    ]);

    await openListMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: EXPAND_ALL_LABEL }),
    );

    expect(collapsedStateOf(container, 'resolved-1')).toBe('false');
    expect(collapsedStateOf(container, 'resolved-2')).toBe('false');
    expect(collapsedStateOf(container, 'open-1')).toBe('false');
    expect(resolveInlineComment).not.toHaveBeenCalled();
  });

  it('disables the unfold-all item while no inline comment is resolved (Requirement 22.5)', async () => {
    renderPageComment([inlineComment('open-1', '2024-01-01T00:00:00.000Z')]);

    await openListMenu();

    expect(screen.getByText(EXPAND_ALL_LABEL).closest('button')).toBeDisabled();
  });

  it('shows the menu to a read-only user as well, and it still works (Requirement 22.1, 22.7)', async () => {
    const { container } = renderPageComment(
      [inlineComment('resolved-1', '2024-01-01T00:00:00.000Z', resolvedAt)],
      true,
    );

    await openListMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: EXPAND_ALL_LABEL }),
    );

    expect(collapsedStateOf(container, 'resolved-1')).toBe('false');
  });

  it('shows the menu to a user who can write, too (Requirement 22.1)', () => {
    renderPageComment(
      [inlineComment('open-1', '2024-01-01T00:00:00.000Z')],
      false,
    );

    expect(
      screen.getByRole('button', { name: LIST_MENU_LABEL }),
    ).toBeInTheDocument();
  });

  it('shows no menu when the page has normal comments only (Requirement 22.1)', () => {
    commentStore.data = [normalComment('normal-1', '2024-01-01T00:00:00.000Z')];

    const { container } = renderPageComment([]);

    expect(
      within(container).queryByRole('button', { name: LIST_MENU_LABEL }),
    ).toBeNull();
    expect(renderedItemIds(container)).toEqual(['normal-1']);
  });

  it('portals the list menu into the supplied slot so it can share a row with the Comments heading (Requirement 22.1)', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);

    const { container } = render(
      <PageComment
        // biome-ignore lint/suspicious/noExplicitAny: RevisionRenderer is not exercised here
        rendererOptions={{} as any}
        pageId="page1"
        pagePath="/path/to/page"
        revision="revision1"
        currentUser={{ username: 'alice' }}
        isReadOnly
        listMenuSlot={slot}
        inlineComments={{
          comments: [inlineComment('open-1', '2024-01-01T00:00:00.000Z')],
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

    expect(
      within(container).queryByRole('button', { name: LIST_MENU_LABEL }),
    ).toBeNull();
    expect(
      within(slot).getByRole('button', { name: LIST_MENU_LABEL }),
    ).toBeInTheDocument();

    slot.remove();
  });

  it('shows an expanded comment as expanded after it is set back to unresolved, and folds it again once it is resolved again (Requirement 20.4)', async () => {
    commentStore.data = [];
    const open = inlineComment('c-1', '2024-01-01T00:00:00.000Z');
    const resolved = inlineComment(
      'c-1',
      '2024-01-01T00:00:00.000Z',
      resolvedAt,
    );
    const { container, rerender } = renderPageComment([resolved]);

    await userEvent.click(screen.getByText('expand c-1'));
    expect(collapsedStateOf(container, 'c-1')).toBe('false');

    // The reader sets it back to unresolved; the revalidated data then arrives.
    await userEvent.click(screen.getByText('toggle-resolved c-1'));
    expect(resolveInlineComment).toHaveBeenCalledWith('c-1', false);
    rerender(pageCommentElement([open]));
    expect(collapsedStateOf(container, 'c-1')).toBe('false');

    // Resolving it again must not leave it expanded.
    rerender(pageCommentElement([resolved]));
    expect(collapsedStateOf(container, 'c-1')).toBe('true');
  });

  it('keeps a comment expanded when the resolve request fails (Requirement 21.2)', async () => {
    const resolved = inlineComment(
      'c-1',
      '2024-01-01T00:00:00.000Z',
      resolvedAt,
    );
    const { container, rerender } = renderPageComment([resolved]);
    resolveInlineComment.mockRejectedValueOnce(new Error('boom'));

    await userEvent.click(screen.getByText('expand c-1'));
    await userEvent.click(screen.getByText('toggle-resolved c-1'));
    rerender(pageCommentElement([resolved]));

    expect(collapsedStateOf(container, 'c-1')).toBe('false');
  });

  it('renders without error when the list goes from empty to non-empty (the folding state is set up before the early return)', () => {
    commentStore.data = [];
    const { container, rerender } = renderPageComment([]);
    expect(container.querySelector('.page-comments-list')).toBeNull();

    rerender(
      pageCommentElement([
        inlineComment('resolved-1', '2024-01-01T00:00:00.000Z', resolvedAt),
      ]),
    );

    expect(collapsedStateOf(container, 'resolved-1')).toBe('true');
  });
});
