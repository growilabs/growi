import type { IRevisionHasId } from '@growi/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Comments } from './Comments';

const mutate = vi.fn();

vi.mock('~/stores/comment', () => ({
  useSWRxPageComment: () => ({ mutate }),
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
});
