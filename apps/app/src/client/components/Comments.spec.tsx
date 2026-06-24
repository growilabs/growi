import type { IRevisionHasId } from '@growi/core';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

// Stub the dynamically-imported children so the test stays focused on Comments'
// own read-only wiring and does not pull in their heavy dependency graphs.
vi.mock('~/client/components/PageComment', () => ({
  PageComment: ({ isReadOnly }: { isReadOnly: boolean }) => (
    <div data-testid="page-comment" data-readonly={String(isReadOnly)} />
  ),
}));
vi.mock('./PageComment/CommentEditor', () => ({
  CommentEditorPre: () => <div data-testid="comment-editor-pre" />,
}));

const revision = { _id: 'revision-1' } as IRevisionHasId;

const renderComments = (isReadOnly?: boolean) =>
  render(
    <Comments
      pageId="page-1"
      pagePath="/foo"
      revision={revision}
      isReadOnly={isReadOnly}
    />,
  );

describe('Comments.tsx', () => {
  afterEach(() => {
    commentStore.data = undefined;
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
});
