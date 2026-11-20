/**
 * Tests for the normal comment list item: its DOM structure, and the delete
 * confirmation it now owns itself.
 *
 * The structure block pins `Comment.tsx`'s output across its rewrite onto the
 * shared `CommentCard`, proving Req 13.9 ("the normal comment's list item
 * appearance must not change").
 *
 * Per design.md's Testing Strategy, a text-content assertion would still pass
 * even if the DOM were rebuilt into a different shape, so this test instead
 * walks the container chain as DOM structure: the outermost `comment-styles`
 * CSS-module class, containing `.page-comment`, containing
 * `.page-comment-main.bg-comment.rounded`, containing a header row
 * (`.d-flex.align-items-center`) and `.page-comment-body`.
 */

import type { JSX, ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ICommentHasId } from '../../../interfaces/comment';

// ---------------------------------------------------------------------------
// Module mocks
//
// These stub out heavy/irrelevant subtrees (markdown rendering, the CodeMirror
// -based re-edit editor, tooltips) so the test can focus on the container
// chain that Req 13.9 cares about, without depending on their internals.
// ---------------------------------------------------------------------------

vi.mock('./Comment.module.scss', () => ({
  default: { 'comment-styles': 'comment-styles' },
}));

vi.mock('@growi/ui/dist/components', () => ({
  UserPicture: () => <span data-testid="user-picture" />,
}));

vi.mock('../../../components/PageView/RevisionRenderer', () => ({
  default: ({ markdown }: { markdown: string }) => (
    <div data-testid="revision-renderer">{markdown}</div>
  ),
}));

vi.mock('./DeleteConfirmAlert.module.scss', () => ({
  default: { 'delete-confirm-alert': 'delete-confirm-alert' },
}));

// `CommentControl` itself is kept real: the delete flow below is driven
// through the actual `comment-delete-button`, so nothing about which control
// opens the confirmation is re-stated by a stub. Only the read-only
// restriction it wraps its buttons in — a collaborator with its own tests
// that would otherwise pull in jotai and the context stores — is mocked at
// the component boundary.
vi.mock('../NotAvailableForReadOnlyUser', () => ({
  NotAvailableIfReadOnlyUserNotAllowedToComment: ({
    children,
  }: {
    children: ReactNode;
  }) => <>{children}</>,
}));

vi.mock('./CommentEditor', () => ({
  CommentEditor: () => <div data-testid="comment-editor" />,
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('reactstrap', () => ({
  UncontrolledTooltip: () => null,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    id,
    className,
  }: {
    href: string;
    children: ReactNode;
    id?: string;
    className?: string;
  }): JSX.Element => (
    <a href={href} id={id} className={className}>
      {children}
    </a>
  ),
}));

import { Comment } from './Comment';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const creator = {
  _id: 'user1',
  __v: 0,
  name: 'Alice',
  username: 'alice',
  email: 'alice@example.com',
  isEmailPublished: true,
};

const baseComment = {
  _id: 'comment1',
  __v: 0,
  page: 'page1',
  creator,
  revision: 'revision1',
  comment: 'hello world',
  commentPosition: 0,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
} as unknown as ICommentHasId;

const noop = () => {
  /* noop */
};

const asyncNoop = async () => {
  /* noop */
};

type RenderOverrides = {
  currentUsername?: string;
  isReadOnly?: boolean;
  onDeleteConfirmed?: (comment: ICommentHasId) => Promise<void>;
};

const renderComment = (
  comment: ICommentHasId = baseComment,
  overrides: RenderOverrides = {},
) =>
  render(
    <Comment
      comment={comment}
      // biome-ignore lint/suspicious/noExplicitAny: rendererOptions is unused because RevisionRenderer is mocked
      rendererOptions={{} as any}
      revisionId="revision1"
      revisionCreatedAt={new Date('2024-01-01T00:00:00.000Z')}
      currentUser={
        {
          username: overrides.currentUsername ?? 'someone-else',
          // biome-ignore lint/suspicious/noExplicitAny: currentUser only needs a username for this test
        } as any
      }
      isReadOnly={overrides.isReadOnly ?? true}
      pageId="page1"
      pagePath="/path/to/page"
      onDeleteConfirmed={overrides.onDeleteConfirmed ?? asyncNoop}
      onComment={noop}
    />,
  );

/** Renders the comment as its own author, with editing allowed. */
const renderOwnComment = (
  onDeleteConfirmed?: (comment: ICommentHasId) => Promise<void>,
) =>
  renderComment(baseComment, {
    currentUsername: 'alice',
    isReadOnly: false,
    onDeleteConfirmed,
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Comment — normal comment list item DOM structure (Req 13.9 baseline)', () => {
  it('nests comment-styles > .page-comment > .page-comment-main.bg-comment.rounded', () => {
    const { container } = renderComment();

    const commentStylesRoot = container.querySelector('.comment-styles');
    expect(commentStylesRoot).not.toBeNull();

    const pageComment = commentStylesRoot?.querySelector(
      '#comment1.page-comment',
    );
    expect(pageComment).not.toBeNull();
    // .page-comment must be a direct child of the comment-styles container.
    expect(pageComment?.parentElement).toBe(commentStylesRoot);

    const main = pageComment?.querySelector(
      '.page-comment-main.bg-comment.rounded',
    );
    expect(main).not.toBeNull();
    // .page-comment-main must be a direct child of .page-comment.
    expect(main?.parentElement).toBe(pageComment);
  });

  it('the comment-main box directly contains a header row and the comment body', () => {
    const { container } = renderComment();

    const main = container.querySelector(
      '.comment-styles .page-comment .page-comment-main.bg-comment.rounded',
    );
    expect(main).not.toBeNull();

    const header = main?.querySelector('.d-flex.align-items-center');
    expect(header).not.toBeNull();
    expect(header?.parentElement).toBe(main);

    const body = main?.querySelector('.page-comment-body');
    expect(body).not.toBeNull();
    expect(body?.parentElement).toBe(main);

    // The header row must precede the body, as in the current DOM order.
    const children = Array.from(main?.children ?? []);
    expect(children.indexOf(header as Element)).toBeLessThan(
      children.indexOf(body as Element),
    );
  });

  it('the header row contains the user picture, username, and the posted-date link', () => {
    const { container } = renderComment();

    const header = container.querySelector(
      '.comment-styles .page-comment .page-comment-main .d-flex.align-items-center',
    );
    expect(header).not.toBeNull();
    expect(
      header?.querySelector('[data-testid="user-picture"]'),
    ).not.toBeNull();
    expect(
      header?.querySelector(`a[href="#${baseComment._id}"]`),
    ).not.toBeNull();
  });

  it('the comment body wraps the rendered markdown content', () => {
    const { container } = renderComment();

    const body = container.querySelector(
      '.comment-styles .page-comment .page-comment-main .page-comment-body',
    );
    expect(body).not.toBeNull();
    expect(
      body?.querySelector('[data-testid="revision-renderer"]'),
    ).not.toBeNull();
  });
});

/**
 * The delete confirmation is the normal comment's own local state now, shown
 * as the inline alert shared with the inline comment instead of the
 * page-level delete modal (design.md: 削除確認UIの共通化). The
 * component's contract here is: only its own author can open the
 * confirmation, the delete request is sent only once the confirmation is
 * confirmed, and a failed request is reported in place.
 */
describe('Comment — delete confirmation (design.md: 削除確認UIの共通化)', () => {
  it('shows the delete control only to the comment’s own author', () => {
    renderComment(baseComment, {
      currentUsername: 'someone-else',
      isReadOnly: false,
    });
    expect(
      screen.queryByTestId('comment-delete-button'),
    ).not.toBeInTheDocument();
  });

  it('opens the inline confirmation instead of deleting right away, and no modal is used', async () => {
    const onDeleteConfirmed = vi.fn(async () => undefined);
    renderOwnComment(onDeleteConfirmed);

    await userEvent.click(screen.getByTestId('comment-delete-button'));

    expect(screen.getByTestId('comment-delete-confirm')).toBeInTheDocument();
    expect(onDeleteConfirmed).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The controls step aside while the confirmation occupies their place, so
    // the delete request cannot be triggered twice.
    expect(
      screen.queryByTestId('comment-delete-button'),
    ).not.toBeInTheDocument();
  });

  it('calls onDeleteConfirmed with this comment only after the confirmation is confirmed', async () => {
    const onDeleteConfirmed = vi.fn(async () => undefined);
    renderOwnComment(onDeleteConfirmed);

    await userEvent.click(screen.getByTestId('comment-delete-button'));
    await userEvent.click(screen.getByTestId('comment-delete-confirm-button'));

    expect(onDeleteConfirmed).toHaveBeenCalledTimes(1);
    expect(onDeleteConfirmed).toHaveBeenCalledWith(baseComment);
    await waitFor(() => {
      expect(
        screen.queryByTestId('comment-delete-confirm'),
      ).not.toBeInTheDocument();
    });
  });

  it('deletes nothing and closes the confirmation when it is canceled', async () => {
    const onDeleteConfirmed = vi.fn(async () => undefined);
    renderOwnComment(onDeleteConfirmed);

    await userEvent.click(screen.getByTestId('comment-delete-button'));
    await userEvent.click(screen.getByTestId('comment-delete-cancel-button'));

    expect(onDeleteConfirmed).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('comment-delete-confirm'),
    ).not.toBeInTheDocument();
    // ...and the controls are back.
    expect(screen.getByTestId('comment-delete-button')).toBeInTheDocument();
  });

  it('reports a failed delete in place, keeping the comment on screen', async () => {
    const onDeleteConfirmed = vi.fn(async () => {
      throw new Error('deletion refused');
    });
    renderOwnComment(onDeleteConfirmed);

    await userEvent.click(screen.getByTestId('comment-delete-button'));
    await userEvent.click(screen.getByTestId('comment-delete-confirm-button'));

    expect(await screen.findByTestId('comment-delete-error')).toHaveTextContent(
      'deletion refused',
    );
    expect(
      screen.queryByTestId('comment-delete-confirm'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('revision-renderer')).toBeInTheDocument();
  });
});
