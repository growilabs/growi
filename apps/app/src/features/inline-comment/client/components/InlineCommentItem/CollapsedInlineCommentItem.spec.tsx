// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { InlineCommentWithReplies } from '../../../interfaces';

vi.mock('./InlineCommentItem.module.scss', () => ({
  default: {
    'inline-comment-item-styles': 'inline-comment-item-styles',
    'inline-comment-item-collapsed': 'inline-comment-item-collapsed',
    'inline-comment-collapsed-peek': 'inline-comment-collapsed-peek',
    'inline-comment-collapsed-more': 'inline-comment-collapsed-more',
    'inline-comment-status-badge': 'inline-comment-status-badge',
    'icon-button-container': 'icon-button-container',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@growi/ui/dist/components', () => ({
  UserPicture: () => <span data-testid="user-picture" />,
}));

vi.mock('~/components/User/Username', () => ({
  Username: () => <span data-testid="username" />,
}));

vi.mock('~/client/components/FormattedDistanceDate', () => ({
  FormattedDistanceDate: () => <span data-testid="formatted-distance-date" />,
}));

vi.mock('~/components/PageView/RevisionRenderer', () => ({
  default: ({
    markdown,
    additionalClassName,
  }: {
    markdown: string;
    additionalClassName?: string;
  }) => (
    <div className={`wiki ${additionalClassName ?? ''}`.trim()}>{markdown}</div>
  ),
}));

import type { RendererOptions } from '~/interfaces/renderer-options';

import { CollapsedInlineCommentItem } from './CollapsedInlineCommentItem';

const rendererOptions = {} as RendererOptions;

const resolvedComment = (
  overrides: Partial<InlineCommentWithReplies> = {},
): InlineCommentWithReplies => ({
  id: 'comment1',
  pageId: 'page1',
  creatorId: 'user1',
  creator: null,
  comment: 'a distinctive comment body',
  anchorOriginRevisionId: 'revision1',
  anchor: {
    quote: 'the quoted range',
    prefix: '',
    suffix: '',
    approxOffset: 0,
  },
  resolvedById: 'user2',
  resolvedAt: new Date('2026-01-02T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  replies: [],
  ...overrides,
});

const renderCollapsed = (
  handlers: { onExpand?: () => void; onQuoteClick?: () => void } = {},
  overrides: Partial<InlineCommentWithReplies> = {},
  options: { rendererOptions?: RendererOptions | undefined } = {},
) =>
  render(
    <CollapsedInlineCommentItem
      comment={resolvedComment(overrides)}
      rendererOptions={
        'rendererOptions' in options ? options.rendererOptions : rendererOptions
      }
      onExpand={handlers.onExpand ?? vi.fn()}
      onQuoteClick={handlers.onQuoteClick ?? vi.fn()}
    />,
  );

describe('CollapsedInlineCommentItem', () => {
  describe('what it shows (Req 20.2)', () => {
    it('sits in the same styled comment box as the expanded item', () => {
      const { container } = renderCollapsed();

      const item = screen.getByTestId('inline-comment-item');
      expect(item).toHaveAttribute('data-resolved', 'true');
      expect(item).toHaveClass(
        'inline-comment-item',
        'mb-2',
        'inline-comment-item-collapsed',
      );
      expect(
        container.querySelector(
          '.inline-comment-item-styles .page-comment.inline-comment-item-resolved .page-comment-main',
        ),
      ).not.toBeNull();
    });

    it('shows the author, the posted date and the resolved badge in the header row', () => {
      const { container } = renderCollapsed();

      const header = container.querySelector(
        '.page-comment-main > .d-flex.align-items-center',
      );
      expect(
        header?.querySelector('[data-testid="user-picture"]'),
      ).not.toBeNull();
      expect(header?.querySelector('[data-testid="username"]')).not.toBeNull();
      expect(
        header?.querySelector('[data-testid="formatted-distance-date"]'),
      ).not.toBeNull();

      const badge = screen.getByTestId('inline-comment-status');
      expect(header?.contains(badge)).toBe(true);
      expect(badge).toHaveTextContent('inline_comment.resolved');
      expect(badge).toHaveClass('bg-success-subtle', 'text-success-emphasis');
    });

    it('shows the anchored quote, truncated to a few lines', () => {
      renderCollapsed(
        {},
        {
          anchor: {
            quote: 'a distinctive quoted range',
            prefix: '',
            suffix: '',
            approxOffset: 0,
          },
        },
      );

      const quote = document.querySelector('blockquote.inline-comment-quote');
      expect(quote).toHaveTextContent('a distinctive quoted range');
      // The clamp (overflow: hidden) must sit inside the padded blockquote;
      // on the blockquote itself the padding would show a sliver of line 3.
      expect(quote).not.toHaveClass('inline-comment-quote-clamped');
      const clamp = quote?.querySelector('.inline-comment-quote-clamped');
      expect(clamp).toHaveTextContent('a distinctive quoted range');
    });

    it('places the expand button immediately to the left of the badge, outside the hover-reveal container', () => {
      renderCollapsed();

      const expandButton = screen.getByRole('button', {
        name: 'inline_comment.expand',
      });
      const badge = screen.getByTestId('inline-comment-status');

      expect(expandButton.nextElementSibling).toBe(badge);
      expect(expandButton.closest('.ms-auto')).toBe(badge.parentElement);
      expect(expandButton.closest('.icon-button-container')).toBeNull();
    });

    it('shows a height-clipped rendered peek of the comment body', () => {
      const { container } = renderCollapsed();

      const peek = screen.getByTestId('inline-comment-collapsed-peek');
      expect(peek).toHaveClass('inline-comment-collapsed-peek');
      expect(peek.querySelector('.wiki.comment')).toHaveTextContent(
        'a distinctive comment body',
      );
      // No replies / resolve / edit controls while collapsed.
      expect(
        screen.queryByTestId('inline-comment-resolve-toggle-button'),
      ).not.toBeInTheDocument();
      expect(
        container.querySelector('.inline-comment-collapsed-peek-text'),
      ).toBeNull();
    });

    it('falls back to plain text when renderer options are still loading', () => {
      renderCollapsed({}, {}, { rendererOptions: undefined });

      const peek = screen.getByTestId('inline-comment-collapsed-peek');
      expect(peek.querySelector('.wiki')).toBeNull();
      expect(peek).toHaveTextContent('a distinctive comment body');
    });

    it('does not show the resolve toggle, edit/delete buttons or the revision link', () => {
      const { container } = renderCollapsed();

      expect(
        screen.queryByTestId('inline-comment-resolve-toggle-button'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('inline-comment-edit-button'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('inline-comment-delete-button'),
      ).not.toBeInTheDocument();
      expect(
        container.querySelector('#page-comment-revision-comment1'),
      ).toBeNull();
      // Quote, header expand chevron, and bottom "More" are operable.
      expect(screen.getAllByRole('button')).toHaveLength(3);
    });
  });

  describe('what it does (Req 21.1 / Req 16)', () => {
    it('calls onExpand when the expand button is clicked', async () => {
      const onExpand = vi.fn();
      renderCollapsed({ onExpand });

      await userEvent.click(
        screen.getByRole('button', { name: 'inline_comment.expand' }),
      );

      expect(onExpand).toHaveBeenCalledTimes(1);
    });

    it('calls onExpand when the bottom More control is clicked', async () => {
      const onExpand = vi.fn();
      renderCollapsed({ onExpand });

      await userEvent.click(
        screen.getByTestId('inline-comment-expand-more-button'),
      );

      expect(onExpand).toHaveBeenCalledTimes(1);
    });

    it('keeps the quote clickable', async () => {
      const onQuoteClick = vi.fn();
      const onExpand = vi.fn();
      renderCollapsed({ onQuoteClick, onExpand });

      await userEvent.click(
        document.querySelector('blockquote.inline-comment-quote') as Element,
      );

      expect(onQuoteClick).toHaveBeenCalledTimes(1);
      expect(onExpand).not.toHaveBeenCalled();
    });
  });
});
