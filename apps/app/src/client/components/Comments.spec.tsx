import type { IRevisionHasId } from '@growi/core';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InlineCommentWithReplies } from '~/features/inline-comment/interfaces';

import { Comments } from './Comments';

const mutate = vi.fn();

const commentStore = vi.hoisted(() => ({
  data: undefined as unknown[] | undefined,
}));

vi.mock('~/stores/comment', () => ({
  useSWRxPageComment: () => ({ data: commentStore.data, mutate }),
}));
vi.mock('~/stores/page', () => ({
  useSWRMUTxPageInfo: () => ({ trigger: vi.fn() }),
}));
vi.mock('~/states/page', () => ({
  useIsTrashPage: () => false,
}));
vi.mock('~/states/global', () => ({
  useCurrentUser: () => null,
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Captures every props object PageComment was rendered with, so a test can
// assert exactly what `Comments` forwarded -- including whether
// `inlineComments` was passed at all.
const pageCommentPropsCalls: Array<{ inlineComments: unknown }> = [];

// Stub the dynamically-imported children so the test stays focused on Comments'
// own read-only wiring and does not pull in their heavy dependency graphs.
vi.mock('~/client/components/PageComment', () => ({
  PageComment: (props: { isReadOnly: boolean; inlineComments: unknown }) => {
    pageCommentPropsCalls.push({ inlineComments: props.inlineComments });
    return (
      <div
        data-testid="page-comment"
        data-readonly={String(props.isReadOnly)}
      />
    );
  },
}));
vi.mock('./PageComment/CommentEditor', () => ({
  CommentEditorPre: () => <div data-testid="comment-editor-pre" />,
}));

const revision = { _id: 'revision-1' } as IRevisionHasId;

const renderComments = (
  isReadOnly?: boolean,
  inlineComments?: {
    comments: InlineCommentWithReplies[];
    resolve: (id: string, resolved: boolean) => Promise<unknown>;
    createReply: (parentId: string, comment: string) => Promise<unknown>;
    update: (id: string, comment: string) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
    updateReply: (id: string, comment: string) => Promise<unknown>;
    removeReply: (id: string) => Promise<unknown>;
    scrollToRange: (commentId: string) => boolean;
  },
) =>
  render(
    <Comments
      pageId="page-1"
      pagePath="/foo"
      revision={revision}
      isReadOnly={isReadOnly}
      inlineComments={inlineComments}
    />,
  );

describe('Comments.tsx', () => {
  afterEach(() => {
    commentStore.data = undefined;
    pageCommentPropsCalls.length = 0;
  });

  it('renders the comment posting area when isReadOnly is omitted', () => {
    const { container } = renderComments();
    expect(container.querySelector('#page-comment-write')).toBeInTheDocument();
  });

  it('does not render the comment posting area when isReadOnly is true', () => {
    const { container } = renderComments(true);
    expect(
      container.querySelector('#page-comment-write'),
    ).not.toBeInTheDocument();
  });

  it('propagates isReadOnly=true to PageComment', async () => {
    renderComments(true);
    const pageComment = await screen.findByTestId('page-comment');
    expect(pageComment).toHaveAttribute('data-readonly', 'true');
  });

  it('propagates isReadOnly=false to PageComment when omitted', async () => {
    renderComments();
    const pageComment = await screen.findByTestId('page-comment');
    expect(pageComment).toHaveAttribute('data-readonly', 'false');
  });

  it('shows the empty-state message when read-only and there are no comments', () => {
    commentStore.data = [];
    renderComments(true);
    expect(screen.getByText('page_comment.no_comments')).toBeInTheDocument();
  });

  it('does not show the empty-state message when there are comments', () => {
    commentStore.data = [{ _id: 'comment-1' }];
    renderComments(true);
    expect(
      screen.queryByText('page_comment.no_comments'),
    ).not.toBeInTheDocument();
  });

  it('does not show the empty-state message on editable views even when empty', () => {
    commentStore.data = [];
    renderComments(false);
    expect(
      screen.queryByText('page_comment.no_comments'),
    ).not.toBeInTheDocument();
  });

  it('renders without error and passes no inlineComments to PageComment when the prop is omitted', async () => {
    renderComments();
    await screen.findByTestId('page-comment');

    expect(pageCommentPropsCalls).toHaveLength(1);
    expect(pageCommentPropsCalls[0].inlineComments).toBeUndefined();
  });

  it('forwards a supplied inlineComments object to PageComment unchanged', async () => {
    const inlineComments = {
      comments: [] as InlineCommentWithReplies[],
      resolve: vi.fn(),
      createReply: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      updateReply: vi.fn(),
      removeReply: vi.fn(),
      scrollToRange: vi.fn(() => true),
    };

    renderComments(false, inlineComments);
    await screen.findByTestId('page-comment');

    expect(pageCommentPropsCalls).toHaveLength(1);
    expect(pageCommentPropsCalls[0].inlineComments).toBe(inlineComments);
  });

  it('forwards scrollToRange within the inlineComments bundle to PageComment unchanged (task 4.2, Requirement 3.1)', async () => {
    const scrollToRange = vi.fn(() => true);
    const inlineComments = {
      comments: [] as InlineCommentWithReplies[],
      resolve: vi.fn(),
      createReply: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      updateReply: vi.fn(),
      removeReply: vi.fn(),
      scrollToRange,
    };

    renderComments(false, inlineComments);
    await screen.findByTestId('page-comment');

    expect(pageCommentPropsCalls).toHaveLength(1);
    const forwarded = pageCommentPropsCalls[0].inlineComments as
      | typeof inlineComments
      | undefined;
    expect(forwarded?.scrollToRange).toBe(scrollToRange);
  });
});
