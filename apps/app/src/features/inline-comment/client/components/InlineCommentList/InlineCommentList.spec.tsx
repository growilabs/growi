// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSchema } from 'hast-util-sanitize';
import sanitize from 'rehype-sanitize';
import deepmerge from 'ts-deepmerge';

import type { RendererOptions } from '~/interfaces/renderer-options';
import {
  remarkPlugin as mentionRemarkPlugin,
  sanitizeOption as mentionSanitizeOption,
} from '~/services/renderer/remark-plugins/mention';

import type { InlineCommentWithReplies } from '../../../interfaces';
import { InlineCommentList } from './InlineCommentList';

// `InlineCommentList` reaches the store and the shared renderer-options SWR
// hook directly (matching the pattern `PageComment.tsx` already uses for
// the legacy comment feature) rather than receiving them as props, so both
// are mocked at the module boundary.
const useSWRxInlineComments = vi.fn();
vi.mock('../../stores/inline-comment', () => ({
  useSWRxInlineComments: (...args: unknown[]) => useSWRxInlineComments(...args),
}));

const useCommentForCurrentPageOptions = vi.fn();
vi.mock('~/stores/renderer', () => ({
  useCommentForCurrentPageOptions: () => useCommentForCurrentPageOptions(),
}));

/**
 * Builds `RendererOptions` around the REAL mention remark plugin
 * (`~/services/renderer/remark-plugins/mention`) — the same module
 * `generateCommentViewOptions` injects for the existing comment feature —
 * so the mention test below exercises the genuine mechanism, not a
 * hand-rolled highlighter. It deliberately skips the rest of
 * `generateCommentViewOptions`'s heavy plugin graph (drawio/katex/mermaid),
 * which is orthogonal to what this component test needs to prove.
 */
const buildMentionAwareRendererOptions = (): RendererOptions => ({
  remarkPlugins: [mentionRemarkPlugin],
  rehypePlugins: [[sanitize, deepmerge(defaultSchema, mentionSanitizeOption)]],
  components: {},
});

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
  useSWRxInlineComments.mockReset();
  useCommentForCurrentPageOptions.mockReset();
  useCommentForCurrentPageOptions.mockReturnValue({
    data: buildMentionAwareRendererOptions(),
  });
});

describe('InlineCommentList', () => {
  it('renders nothing while the list is still loading', () => {
    useSWRxInlineComments.mockReturnValue({
      data: undefined,
      resolve: vi.fn(),
      createReply: vi.fn(),
    });

    const { container } = render(<InlineCommentList pageId="page1" />);

    expect(container.innerHTML).toBe('');
  });

  it('renders comments in the order the store returns them, without re-sorting', () => {
    const list = [
      originComment({ id: 'c-newest', comment: 'newest' }),
      originComment({ id: 'c-oldest', comment: 'oldest' }),
    ];
    useSWRxInlineComments.mockReturnValue({
      data: list,
      resolve: vi.fn(),
      createReply: vi.fn(),
    });

    render(<InlineCommentList pageId="page1" />);

    const items = screen.getAllByTestId('inline-comment-item');
    expect(items).toHaveLength(2);
    // Order-preserving: the first store-returned comment renders first,
    // regardless of its content — this component must not re-sort.
    expect(items[0]).toHaveTextContent('newest');
    expect(items[1]).toHaveTextContent('oldest');
  });

  it('visually distinguishes a resolved comment from an unresolved one', () => {
    const list = [
      originComment({ id: 'c-open', comment: 'open one' }),
      originComment({
        id: 'c-resolved',
        comment: 'resolved one',
        resolvedById: 'user2',
        resolvedAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
    ];
    useSWRxInlineComments.mockReturnValue({
      data: list,
      resolve: vi.fn(),
      createReply: vi.fn(),
    });

    render(<InlineCommentList pageId="page1" />);

    const statuses = screen.getAllByTestId('inline-comment-status');
    expect(statuses[0]).toHaveTextContent('Unresolved');
    expect(statuses[1]).toHaveTextContent('Resolved');

    const items = screen.getAllByTestId('inline-comment-item');
    expect(items[0]).toHaveAttribute('data-resolved', 'false');
    expect(items[1]).toHaveAttribute('data-resolved', 'true');
  });

  it('calls resolve(id, true) when an unresolved comment is resolved', async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    useSWRxInlineComments.mockReturnValue({
      data: [originComment({ id: 'comment1', resolvedAt: null })],
      resolve,
      createReply: vi.fn(),
    });

    render(<InlineCommentList pageId="page1" />);

    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(resolve).toHaveBeenCalledWith('comment1', true);
  });

  it('calls resolve(id, false) when a resolved comment is reopened', async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    useSWRxInlineComments.mockReturnValue({
      data: [
        originComment({
          id: 'comment1',
          resolvedById: 'user2',
          resolvedAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
      ],
      resolve,
      createReply: vi.fn(),
    });

    render(<InlineCommentList pageId="page1" />);

    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));

    expect(resolve).toHaveBeenCalledWith('comment1', false);
  });

  it('surfaces an error and does not crash when resolve() rejects', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('network down'));
    useSWRxInlineComments.mockReturnValue({
      data: [originComment({ id: 'comment1', resolvedAt: null })],
      resolve,
      createReply: vi.fn(),
    });

    render(<InlineCommentList pageId="page1" />);

    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => {
      expect(
        screen.getByTestId('inline-comment-resolve-error'),
      ).toHaveTextContent('network down');
    });
    // The item itself must still be on screen — a rejected resolve must not
    // unmount or otherwise break the list.
    expect(screen.getByTestId('inline-comment-item')).toBeInTheDocument();
  });

  it('renders @username in the comment body with the real mention plugin markup', async () => {
    useSWRxInlineComments.mockReturnValue({
      data: [originComment({ comment: 'hello @alice, please check this' })],
      resolve: vi.fn(),
      createReply: vi.fn(),
    });

    render(<InlineCommentList pageId="page1" />);

    // Genuine reuse check: this DOM shape (`span.mention-user` with
    // `data-mention`) is produced by the actual
    // `services/renderer/remark-plugins/mention.ts` module (imported, not
    // reimplemented above) — the same one `generateCommentViewOptions` wires
    // in for the existing comment feature. A hand-rolled highlighter would
    // not reproduce this exact markup.
    await waitFor(() => {
      const mention = document.querySelector('[data-mention]');
      expect(mention).not.toBeNull();
      expect(mention).toHaveClass('mention-user');
      expect(mention).toHaveAttribute('data-mention', 'alice');
      expect(mention).toHaveTextContent('@alice');
    });
  });
});
