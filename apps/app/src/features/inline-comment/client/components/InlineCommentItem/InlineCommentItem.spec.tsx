// @vitest-environment happy-dom

/**
 * Unit tests for the inline-comment list item after it was moved out of
 * `InlineCommentList/` and rewritten to use the shared `CommentCard`
 * (design.md: `InlineCommentItem`（`InlineCommentList` から移動・構造を変更）).
 *
 * Per design.md's Testing Strategy for Req 13.3 / 13.4, these tests walk the
 * container chain as DOM structure — the module container, `.page-comment`,
 * `.page-comment-main.bg-comment.rounded`, the header row and
 * `.page-comment-body` — instead of asserting rendered text. A text-only
 * assertion would still pass if the item were rebuilt as a parallel
 * implementation that merely copied the class names, which is exactly what
 * this task must rule out.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { RendererOptions } from '~/interfaces/renderer-options';

import type { InlineCommentWithReplies } from '../../../interfaces';

// ---------------------------------------------------------------------------
// Module mocks
//
// The unit boundary is the item itself. The author picture / name and the
// distance-date formatter are collaborators owned by `CommentCard`; the
// replies subtree is a separate component with its own spec.
// ---------------------------------------------------------------------------

// `inline-comment-quote` is declared as `:global(.inline-comment-quote)` in the
// real SCSS, so CSS Modules never adds it to the JS-side lookup table — the
// mock must not fabricate that key, or a regression where the component reads
// `styles['inline-comment-quote']` (always `undefined` in the real build)
// would still pass here.
vi.mock('./InlineCommentItem.module.scss', () => ({
  default: {
    'inline-comment-item-styles': 'inline-comment-item-styles',
    'inline-comment-status-badge': 'inline-comment-status-badge',
    'icon-button-container': 'icon-button-container',
  },
}));

// The edit/delete buttons' own sizing/opacity class now lives in the shared
// `CommentEditDeleteButtons.module.scss` (2026-09-11), not this file's own
// module -- mocked the same identity way so assertions can match the plain
// string.
vi.mock(
  '~/client/components/PageComment/CommentEditDeleteButtons.module.scss',
  () => ({
    default: {
      'icon-button': 'icon-button',
    },
  }),
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The shared `DeleteConfirmAlert` translates through `next-i18next`, the form
// its own directory (`client/components/PageComment/`) uses. Mocking it is not
// only about the stubbed labels: loading the real `next-i18next` here drags
// Next.js internals into this spec's module graph, which replaces DOM globals
// and made an unrelated DOM-structure test below read `undefined` out of an
// element's own `children`.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock(
  '~/client/components/PageComment/DeleteConfirmAlert.module.scss',
  () => ({
    default: { 'delete-confirm-alert': 'delete-confirm-alert' },
  }),
);

vi.mock('@growi/ui/dist/components', () => ({
  UserPicture: () => <span data-testid="user-picture" />,
}));

vi.mock('~/components/User/Username', () => ({
  Username: () => <span data-testid="username" />,
}));

vi.mock('~/client/components/FormattedDistanceDate', () => ({
  FormattedDistanceDate: () => <span data-testid="formatted-distance-date" />,
}));

vi.mock('./InlineCommentReplies', () => ({
  InlineCommentReplies: () => <div data-testid="inline-comment-replies" />,
}));

// The current user drives the author-only check for edit/delete (design.md:
// `comment.creatorId === currentUser?._id`, never the populated `creator`).
// Mutable via `currentUserRef` so individual tests can simulate "viewing as
// the comment's own author" vs. "viewing as someone else".
const currentUserRef = vi.hoisted(
  () => ({ current: undefined }) as { current?: { _id: string } },
);
vi.mock('~/states/global', () => ({
  useCurrentUser: () => currentUserRef.current,
}));

// The read-only restriction is `NotAvailableIfReadOnlyUserNotAllowedToComment`'s
// own concern (it already has its own tests) — this file mocks it directly at
// the component boundary, toggled per test via `isDisabledRef`, so a test can
// assert "the edit/delete controls are disabled under the read-only
// restriction" without re-deriving `NotAvailable`'s own DOM rendering.
const isDisabledRef = vi.hoisted(() => ({ current: false }));
vi.mock('~/client/components/NotAvailableForReadOnlyUser', () => ({
  NotAvailableIfReadOnlyUserNotAllowedToComment: ({
    children,
  }: {
    children: JSX.Element;
  }) => {
    if (!isDisabledRef.current) {
      return children;
    }
    return (
      <fieldset disabled data-testid="not-available-for-read-only-user">
        {children}
      </fieldset>
    );
  },
}));

// 2026-09-11: the origin comment's edit mode now uses the literal same
// `CommentEditor` the normal comment's own re-edit uses (`Comment.tsx`),
// unifying the two editing experiences per the user's request -- no longer
// `MentionAwareCommentInput`. `CommentEditor`'s own internal behavior
// (toolbar, submit/cancel rendering, canSubmit gating) is covered by its own
// spec; mocked at the boundary here so this file only proves the wiring this
// component owns: which props reach `CommentEditor`, and how its
// `onSubmit`/`onCanceled`/`onCommented` callbacks are handled.
const commentEditorProps = vi.hoisted(
  () => ({ current: undefined }) as { current?: Record<string, unknown> },
);
vi.mock('~/client/components/PageComment/CommentEditor', () => ({
  CommentEditor: (props: Record<string, unknown>) => {
    commentEditorProps.current = props;
    return <div data-testid="inline-comment-editor-mock" />;
  },
}));

import { InlineCommentItem } from './InlineCommentItem';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * `RevisionRenderer` is deliberately NOT mocked: the class it puts on the
 * rendered markdown (`wiki comment`) is exactly what Req 13.3's spacing rules
 * hang on, so the test needs the real component to observe it. A minimal
 * options object is enough — no plugin behavior is under test here.
 */
const rendererOptions: RendererOptions = {
  remarkPlugins: [],
  rehypePlugins: [],
  components: {},
};

const originComment = (
  overrides: Partial<InlineCommentWithReplies> = {},
): InlineCommentWithReplies => ({
  id: 'comment1',
  pageId: 'page1',
  creatorId: 'user1',
  creator: null,
  comment: 'the comment body',
  anchorOriginRevisionId: 'revision1',
  anchor: {
    quote: 'the quoted range',
    prefix: '',
    suffix: '',
    approxOffset: 0,
  },
  resolvedById: null,
  resolvedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  replies: [],
  ...overrides,
});

const renderItem = (
  overrides: Partial<InlineCommentWithReplies> = {},
  handlers: {
    resolve?: (id: string, resolved: boolean) => Promise<unknown>;
    createReply?: (parentId: string, comment: string) => Promise<unknown>;
    update?: (id: string, comment: string) => Promise<unknown>;
    remove?: (id: string) => Promise<unknown>;
    updateReply?: (id: string, comment: string) => Promise<unknown>;
    removeReply?: (id: string) => Promise<unknown>;
    scrollToRange?: (commentId: string) => boolean;
  } = {},
) =>
  render(
    <InlineCommentItem
      comment={originComment(overrides)}
      pagePath="/page1"
      rendererOptions={rendererOptions}
      resolve={handlers.resolve ?? vi.fn().mockResolvedValue(undefined)}
      createReply={handlers.createReply ?? vi.fn().mockResolvedValue(undefined)}
      update={handlers.update ?? vi.fn().mockResolvedValue(undefined)}
      remove={handlers.remove ?? vi.fn().mockResolvedValue(undefined)}
      updateReply={handlers.updateReply ?? vi.fn().mockResolvedValue(undefined)}
      removeReply={handlers.removeReply ?? vi.fn().mockResolvedValue(undefined)}
      scrollToRange={handlers.scrollToRange ?? vi.fn(() => true)}
    />,
  );

const getMain = (container: HTMLElement) =>
  container.querySelector(
    '.inline-comment-item-styles .page-comment .page-comment-main',
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InlineCommentItem', () => {
  beforeEach(() => {
    currentUserRef.current = undefined;
    isDisabledRef.current = false;
    commentEditorProps.current = undefined;
  });

  describe('the shared comment box (Req 13.3 / 13.4)', () => {
    it('nests the module container > .page-comment > .page-comment-main.bg-comment.rounded', () => {
      const { container } = renderItem();

      const moduleRoot = container.querySelector('.inline-comment-item-styles');
      expect(moduleRoot).not.toBeNull();

      const pageComment = moduleRoot?.querySelector('.page-comment');
      expect(pageComment).not.toBeNull();
      expect(pageComment?.parentElement).toBe(moduleRoot);

      const main = pageComment?.querySelector(
        '.page-comment-main.bg-comment.rounded',
      );
      expect(main).not.toBeNull();
      expect(main?.parentElement).toBe(pageComment);
    });

    it('shows the author picture, the author name and the posted date in the header row of that box', () => {
      const { container } = renderItem();

      const header = getMain(container)?.querySelector(
        '.d-flex.align-items-center',
      );
      expect(header).not.toBeNull();
      expect(
        header?.querySelector('[data-testid="user-picture"]'),
      ).not.toBeNull();
      expect(header?.querySelector('[data-testid="username"]')).not.toBeNull();
      expect(
        header?.querySelector('[data-testid="formatted-distance-date"]'),
      ).not.toBeNull();
    });

    it('marks a resolved item on the box itself and on the item wrapper', () => {
      const { container } = renderItem({
        resolvedById: 'user2',
        resolvedAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      expect(
        container.querySelector('[data-testid="inline-comment-item"]'),
      ).toHaveAttribute('data-resolved', 'true');
      expect(
        container.querySelector('.page-comment.inline-comment-item-resolved'),
      ).not.toBeNull();
    });

    it('does not mark an unresolved item as resolved', () => {
      const { container } = renderItem();

      expect(
        container.querySelector('[data-testid="inline-comment-item"]'),
      ).toHaveAttribute('data-resolved', 'false');
      expect(
        container.querySelector('.inline-comment-item-resolved'),
      ).toBeNull();
    });
  });

  describe('the quote (Req 13.6 / 13.10)', () => {
    it('places the quote, then the body — both inside the shared box', () => {
      const { container } = renderItem();

      const main = getMain(container);
      expect(main).not.toBeNull();

      const quote = main?.querySelector('blockquote.inline-comment-quote');
      const body = main?.querySelector('.page-comment-body');

      expect(quote).not.toBeNull();
      expect(body).not.toBeNull();

      const children = Array.from(main?.children ?? []);
      const indexOf = (el: Element | null | undefined) =>
        children.indexOf(el as Element);

      // the quote lives inside a clickable `<button>` wrapper (task 4.3), so
      // its box-order position is the wrapper's index, not its own.
      const quoteRowElement = children.find((child) =>
        child.contains(quote ?? null),
      );
      expect(indexOf(quoteRowElement)).toBeGreaterThanOrEqual(0);
      expect(indexOf(quoteRowElement)).toBeLessThan(indexOf(body));
    });

    it('shows the anchored quote text in the quote element', () => {
      const { container } = renderItem({
        anchor: {
          quote: 'a distinctive quoted range',
          prefix: '',
          suffix: '',
          approxOffset: 0,
        },
      });

      const quote = container.querySelector('blockquote.inline-comment-quote');
      expect(quote).toHaveTextContent('a distinctive quoted range');
    });

    // Requirement 1.7 / 3.4 (design.md 決定3): the left-border marker color
    // stays as-is, and a subtle background utility class is added on top of
    // it, so the list-side quote keeps its existing coloring.
    it('gives the quote block a subtle background in addition to the marker-color left border', () => {
      const { container } = renderItem();

      const quote = container.querySelector('blockquote.inline-comment-quote');
      expect(quote).toHaveClass('bg-body-tertiary');
    });

    it('calls scrollToRange(comment.id) when the quote is clicked (Req 3.1)', async () => {
      const scrollToRange = vi.fn(() => true);
      const { container } = renderItem({}, { scrollToRange });

      const quote = container.querySelector('blockquote.inline-comment-quote');
      expect(quote).not.toBeNull();

      await userEvent.click(quote as Element);

      expect(scrollToRange).toHaveBeenCalledWith('comment1');
    });

    it('calls scrollToRange(comment.id) when the quote button is activated with the keyboard (Enter)', async () => {
      const scrollToRange = vi.fn(() => true);
      const { container } = renderItem({}, { scrollToRange });

      const quoteButton = container
        .querySelector('blockquote.inline-comment-quote')
        ?.closest('button');
      expect(quoteButton).not.toBeNull();

      (quoteButton as HTMLButtonElement).focus();
      await userEvent.keyboard('{Enter}');

      expect(scrollToRange).toHaveBeenCalledWith('comment1');
    });
  });

  describe('the status badge and the resolve toggle (Req 13.7)', () => {
    it('puts both the badge and the toggle at the end of the header row of the shared box', () => {
      const { container } = renderItem();

      const header = getMain(container)?.querySelector(
        '.d-flex.align-items-center',
      );
      const headerEnd = header?.querySelector('.ms-auto');
      expect(headerEnd).not.toBeNull();
      expect(headerEnd?.parentElement).toBe(header);

      const badge = headerEnd?.querySelector(
        '[data-testid="inline-comment-status"]',
      );
      const toggle = headerEnd?.querySelector('button');
      expect(badge).not.toBeNull();
      expect(toggle).not.toBeNull();
    });

    // 2026-09-11 (user request): the badge sits at the row's very corner,
    // with the resolve/reopen toggle just to its left and hover-revealed
    // the same way edit/delete are -- previously always visible.
    it('orders the toggle before the badge and wraps the toggle in the hover-reveal container', () => {
      const { container } = renderItem();

      const headerEnd = getMain(container)?.querySelector('.ms-auto');
      const toggle = screen.getByRole('button', {
        name: 'inline_comment.resolve',
      });
      const badge = screen.getByTestId('inline-comment-status');

      // DOM order: toggle comes before the badge among headerEnd's children.
      const children = Array.from(headerEnd?.children ?? []);
      const toggleContainerIndex = children.findIndex((el) =>
        el.contains(toggle),
      );
      const badgeIndex = children.indexOf(badge);
      expect(toggleContainerIndex).toBeGreaterThanOrEqual(0);
      expect(badgeIndex).toBeGreaterThan(toggleContainerIndex);

      // The toggle shares the same hover-reveal wrapper class as edit/delete.
      expect(toggle.closest('.icon-button-container')).not.toBeNull();
      // The badge itself is not inside that hover-reveal wrapper -- it stays
      // always visible as the item's own status, not an action button.
      expect(badge.closest('.icon-button-container')).toBeNull();
    });

    it('keeps the unresolved badge colour scheme (rounded-pill bg-warning-subtle text-warning-emphasis)', () => {
      renderItem();

      const badge = screen.getByTestId('inline-comment-status');
      expect(badge).toHaveClass(
        'badge',
        'rounded-pill',
        'bg-warning-subtle',
        'text-warning-emphasis',
      );
      expect(badge).toHaveTextContent('inline_comment.unresolved');
    });

    it('switches the badge to the resolved variant when the comment is resolved', () => {
      renderItem({
        resolvedById: 'user2',
        resolvedAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      const badge = screen.getByTestId('inline-comment-status');
      expect(badge).toHaveClass(
        'badge',
        'rounded-pill',
        'bg-success-subtle',
        'text-success-emphasis',
      );
      expect(badge).toHaveTextContent('inline_comment.resolved');
    });

    it('gives the badge the status-dot decoration class (CSS Modules ::before, no inline style)', () => {
      renderItem();

      const badge = screen.getByTestId('inline-comment-status');
      expect(badge).toHaveClass('inline-comment-status-badge');
      expect(badge).not.toHaveAttribute('style');
    });

    it('shapes the resolve toggle as a rounded pill', () => {
      renderItem();

      const toggle = screen.getByRole('button', {
        name: 'inline_comment.resolve',
      });
      expect(toggle).toHaveClass(
        'btn',
        'btn-sm',
        'btn-outline-secondary',
        'rounded-pill',
      );
    });

    it('calls resolve(id, true) when an unresolved comment is resolved', async () => {
      const resolve = vi.fn().mockResolvedValue(undefined);
      renderItem({}, { resolve });

      await userEvent.click(
        screen.getByRole('button', { name: 'inline_comment.resolve' }),
      );

      expect(resolve).toHaveBeenCalledWith('comment1', true);
    });

    it('calls resolve(id, false) when a resolved comment is reopened', async () => {
      const resolve = vi.fn().mockResolvedValue(undefined);
      renderItem(
        {
          resolvedById: 'user2',
          resolvedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
        { resolve },
      );

      await userEvent.click(
        screen.getByRole('button', { name: 'inline_comment.reopen' }),
      );

      expect(resolve).toHaveBeenCalledWith('comment1', false);
    });

    // Requirement 2.3 / 2.4: the resolve/reopen toggle must not be usable by
    // a read-only user who is not allowed to comment. Scoped to the resolve
    // button's own ancestor fieldset (not a page-wide single-match query)
    // because the edit/delete controls' own guard (a separate,
    // independently-rendered fieldset) renders at the same time under this
    // restriction -- same precedent as InlineCommentReplies.spec.tsx's
    // "disables the edit/delete controls" test.
    it('disables the resolve toggle under the read-only restriction', () => {
      isDisabledRef.current = true;
      renderItem();

      const toggle = screen.getByTestId('inline-comment-resolve-toggle-button');
      expect(
        toggle.closest('[data-testid="not-available-for-read-only-user"]'),
      ).not.toBeNull();
      expect(toggle).toBeDisabled();
    });

    it('keeps the resolve toggle enabled when read-only users are allowed to comment', () => {
      isDisabledRef.current = false;
      renderItem();

      const toggle = screen.getByTestId('inline-comment-resolve-toggle-button');
      expect(
        toggle.closest('[data-testid="not-available-for-read-only-user"]'),
      ).toBeNull();
      expect(toggle).not.toBeDisabled();
    });

    it('surfaces an error and keeps the item on screen when resolve() rejects', async () => {
      const resolve = vi.fn().mockRejectedValue(new Error('network down'));
      renderItem({}, { resolve });

      await userEvent.click(
        screen.getByRole('button', { name: 'inline_comment.resolve' }),
      );

      await waitFor(() => {
        expect(
          screen.getByTestId('inline-comment-resolve-error'),
        ).toHaveTextContent('network down');
      });
      expect(screen.getByTestId('inline-comment-item')).toBeInTheDocument();
    });
  });

  // 2026-09-11 (user request): links to the page as it looked when this
  // comment was posted, the same `CommentRevisionLink` a normal comment
  // uses (`Comment.tsx`), reused verbatim rather than a parallel
  // reimplementation.
  describe('the revision-history link', () => {
    // `.page-comment-revision` is also the class CommentCard's own date link
    // carries, so a query by that class alone would match the wrong element
    // -- select by the unique id `CommentRevisionLink` sets instead
    // (`page-comment-revision-${id}`, also its tooltip target).
    it('renders right after the date, not inside the ms-auto header-end group', () => {
      const { container } = renderItem();

      const header = getMain(container)?.querySelector(
        '.d-flex.align-items-center',
      );
      const link = header?.querySelector('#page-comment-revision-comment1');
      expect(link).not.toBeNull();
      expect(link?.closest('.ms-auto')).toBeNull();
      expect(link?.closest('.ms-2')?.parentElement).toBe(header);
    });

    it('links to the page at the anchor origin revision', () => {
      renderItem({ pageId: 'page42', anchorOriginRevisionId: 'revision99' });

      const link = document.getElementById('page-comment-revision-comment1');
      expect(link).toHaveAttribute('href', '/page42?revisionId=revision99');
    });
  });

  describe('the comment body', () => {
    it('renders the body through RevisionRenderer with the comment class, inside .page-comment-body', async () => {
      // Req 13.3: without `additionalClassName="comment"` the rendered markdown
      // only gets `wiki`, so `Comment.module.scss`'s paragraph / blockquote
      // spacing rules (scoped to `.wiki.comment`) never apply to an inline
      // comment. Asserting the emitted class is the observable form of that.
      const { container } = renderItem({ comment: 'the comment body' });

      await waitFor(() => {
        expect(container.querySelector('.wiki.comment')).not.toBeNull();
      });

      const body = getMain(container)?.querySelector('.page-comment-body');
      expect(body?.querySelector('.wiki.comment')).not.toBeNull();
      expect(body).toHaveTextContent('the comment body');
    });

    it('falls back to plain text while the renderer options are still loading', () => {
      const { container } = render(
        <InlineCommentItem
          comment={originComment({ comment: 'unrendered body' })}
          pagePath="/page1"
          rendererOptions={undefined}
          resolve={vi.fn()}
          createReply={vi.fn()}
          update={vi.fn()}
          remove={vi.fn()}
          updateReply={vi.fn()}
          removeReply={vi.fn()}
          scrollToRange={vi.fn(() => true)}
        />,
      );

      expect(container.querySelector('.wiki')).toBeNull();
      expect(
        getMain(container)?.querySelector('.page-comment-body'),
      ).toHaveTextContent('unrendered body');
    });
  });

  describe('the replies subtree', () => {
    it('renders the replies outside the shared comment box, not nested inside it', () => {
      const { container } = renderItem();

      const replies = container.querySelector(
        '[data-testid="inline-comment-replies"]',
      );
      expect(replies).not.toBeNull();
      expect(replies?.closest('.page-comment')).toBeNull();
    });
  });

  describe('edit/delete (Requirement 18.1-18.8)', () => {
    it("shows the edit and delete buttons when the current user is the comment's own creator", () => {
      currentUserRef.current = { _id: 'user1' };
      renderItem({ creatorId: 'user1' });

      expect(
        screen.getByTestId('inline-comment-edit-button'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('inline-comment-delete-button'),
      ).toBeInTheDocument();
    });

    it("hides the edit and delete buttons when the current user is not the comment's own creator", () => {
      currentUserRef.current = { _id: 'someone-else' };
      renderItem({ creatorId: 'user1' });

      expect(
        screen.queryByTestId('inline-comment-edit-button'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('inline-comment-delete-button'),
      ).not.toBeInTheDocument();
    });

    it('hides the edit and delete buttons when there is no current user', () => {
      currentUserRef.current = undefined;
      renderItem({ creatorId: 'user1' });

      expect(
        screen.queryByTestId('inline-comment-edit-button'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('inline-comment-delete-button'),
      ).not.toBeInTheDocument();
    });

    it('disables the edit/delete controls under the read-only restriction', () => {
      currentUserRef.current = { _id: 'user1' };
      isDisabledRef.current = true;
      renderItem({ creatorId: 'user1' });

      // Two independent guards render under this restriction now: the
      // edit/delete controls here, and the resolve toggle covered by its own
      // test in the "status badge and resolve toggle" describe block above
      // -- assert this one via the edit button's own ancestor fieldset
      // rather than a page-wide single-match query (same precedent as
      // InlineCommentReplies.spec.tsx's own "disables the edit/delete
      // controls" test).
      const editButton = screen.getByTestId('inline-comment-edit-button');
      expect(
        editButton.closest('[data-testid="not-available-for-read-only-user"]'),
      ).not.toBeNull();
      expect(editButton).toBeDisabled();
      expect(screen.getByTestId('inline-comment-delete-button')).toBeDisabled();
    });

    // 2026-09-11: origin-comment editing now uses the literal same
    // `CommentEditor` the normal comment's own re-edit uses (unifying with
    // `Comment.tsx` and with the list's reply editing,
    // `InlineCommentReplies.tsx`) -- no longer `MentionAwareCommentInput`.
    // `CommentEditor`'s own internal behavior (toolbar, submit/cancel button
    // rendering, canSubmit gating) is covered by its own spec; these tests
    // only prove the wiring this component owns: which props reach
    // `CommentEditor`, and how its `onSubmit`/`onCanceled`/`onCommented`
    // callbacks are handled here.
    it('switches to CommentEditor with the current text as commentBody and a comment-specific currentCommentId when the edit button is clicked', async () => {
      currentUserRef.current = { _id: 'user1' };
      renderItem({
        id: 'comment42',
        creatorId: 'user1',
        comment: 'the original text',
        pageId: 'page1',
        anchorOriginRevisionId: 'revision1',
      });

      await userEvent.click(screen.getByTestId('inline-comment-edit-button'));

      expect(
        screen.getByTestId('inline-comment-editor-mock'),
      ).toBeInTheDocument();
      expect(commentEditorProps.current?.pageId).toBe('page1');
      expect(commentEditorProps.current?.revisionId).toBe('revision1');
      expect(commentEditorProps.current?.currentCommentId).toBe('comment42');
      expect(commentEditorProps.current?.commentBody).toBe('the original text');
      expect(commentEditorProps.current?.onSubmit).toBeInstanceOf(Function);
      expect(commentEditorProps.current?.onCommented).toBeInstanceOf(Function);
      expect(commentEditorProps.current?.onCanceled).toBeInstanceOf(Function);
    });

    // `CommentCard` is replaced entirely by the
    // editor while editing (matching `Comment.tsx`'s own re-edit), not kept
    // mounted underneath it -- the box, header (avatar/username/date), quote,
    // and status badge/resolve toggle all disappear for the duration of an
    // edit.
    it("replaces the whole CommentCard box (quote, status badge) with the editor while editing, matching a normal comment's re-edit", async () => {
      currentUserRef.current = { _id: 'user1' };
      renderItem({ id: 'comment42', creatorId: 'user1' });

      expect(screen.getByTestId('inline-comment-status')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('inline-comment-edit-button'));

      expect(
        screen.getByTestId('inline-comment-editor-mock'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('inline-comment-status'),
      ).not.toBeInTheDocument();
      expect(
        screen
          .getByTestId('inline-comment-item')
          .querySelector('.page-comment'),
      ).toBeNull();
    });

    it('calls update(id, text) via the onSubmit override, and leaves edit mode when onCommented fires', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      currentUserRef.current = { _id: 'user1' };
      renderItem({ id: 'comment42', creatorId: 'user1' }, { update });

      await userEvent.click(screen.getByTestId('inline-comment-edit-button'));
      await (
        commentEditorProps.current?.onSubmit as (
          text: string,
        ) => Promise<unknown>
      )('the edited text');

      expect(update).toHaveBeenCalledWith('comment42', 'the edited text');

      // The mock does not call onCommented on its own (unlike the real
      // CommentEditor's postCommentHandler) -- simulate that signal.
      act(() => {
        (commentEditorProps.current?.onCommented as () => void)();
      });
      expect(
        screen.queryByTestId('inline-comment-editor-mock'),
      ).not.toBeInTheDocument();
    });

    it("does NOT call update when the editor's onCanceled fires, and reverts to the read-only display", async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      currentUserRef.current = { _id: 'user1' };
      renderItem(
        { id: 'comment42', creatorId: 'user1', comment: 'unchanged text' },
        { update },
      );

      await userEvent.click(screen.getByTestId('inline-comment-edit-button'));
      expect(
        screen.getByTestId('inline-comment-editor-mock'),
      ).toBeInTheDocument();

      act(() => {
        (commentEditorProps.current?.onCanceled as () => void)();
      });

      expect(update).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId('inline-comment-editor-mock'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('inline-comment-item')).toHaveTextContent(
        'unchanged text',
      );
    });

    it('does NOT call remove when the delete button is clicked (only opens a confirmation)', async () => {
      const remove = vi.fn().mockResolvedValue(undefined);
      currentUserRef.current = { _id: 'user1' };
      renderItem({ id: 'comment42', creatorId: 'user1' }, { remove });

      await userEvent.click(screen.getByTestId('inline-comment-delete-button'));

      expect(remove).not.toHaveBeenCalled();
      expect(
        screen.getByTestId('inline-comment-delete-confirm'),
      ).toBeInTheDocument();
    });

    // Requirement 1.3 / 3.1 / 3.4 (design.md: 削除確認): the bare-text-row
    // confirmation is replaced by a Bootstrap `alert` component-based
    // layout (icon + message + button group in one row), not a modal.
    it('renders the delete confirmation as a Bootstrap alert with an icon, message and button group (Req 1.3 / 3.1 / 3.4)', async () => {
      currentUserRef.current = { _id: 'user1' };
      renderItem({ id: 'comment42', creatorId: 'user1' });

      await userEvent.click(screen.getByTestId('inline-comment-delete-button'));

      const confirm = screen.getByTestId('inline-comment-delete-confirm');
      expect(confirm).toHaveClass(
        'alert',
        'alert-danger',
        'd-flex',
        'align-items-center',
        'gap-2',
        'mb-0',
      );
      // The left accent is a CSS Modules rule, not the `border-start
      // border-3` utility pair it replaced: those set `border-left-color` to
      // the neutral `--bs-border-color` with `!important`, which overrode
      // `alert-danger`'s own tone and painted the accent grey.
      expect(confirm.className).toContain('delete-confirm-alert');
      expect(confirm).not.toHaveClass('border-start');
      expect(
        confirm.querySelector('.material-symbols-outlined'),
      ).not.toBeNull();
      expect(confirm).toHaveTextContent('page_comment.delete_comment');
      expect(
        confirm.querySelector(
          '[data-testid="inline-comment-delete-confirm-button"]',
        ),
      ).not.toBeNull();
      expect(
        confirm.querySelector(
          '[data-testid="inline-comment-delete-cancel-button"]',
        ),
      ).not.toBeNull();
      // No modal is used for the confirmation.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('calls remove(id) only after the delete confirmation is confirmed', async () => {
      const remove = vi.fn().mockResolvedValue(undefined);
      currentUserRef.current = { _id: 'user1' };
      renderItem({ id: 'comment42', creatorId: 'user1' }, { remove });

      await userEvent.click(screen.getByTestId('inline-comment-delete-button'));
      await userEvent.click(
        screen.getByTestId('inline-comment-delete-confirm-button'),
      );

      expect(remove).toHaveBeenCalledWith('comment42');
    });

    it('does NOT call remove when the delete confirmation is canceled', async () => {
      const remove = vi.fn().mockResolvedValue(undefined);
      currentUserRef.current = { _id: 'user1' };
      renderItem({ id: 'comment42', creatorId: 'user1' }, { remove });

      await userEvent.click(screen.getByTestId('inline-comment-delete-button'));
      await userEvent.click(
        screen.getByTestId('inline-comment-delete-cancel-button'),
      );

      expect(remove).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId('inline-comment-delete-confirm'),
      ).not.toBeInTheDocument();
    });

    // Requirement 1.5 / 1.6 / 3.3 / 3.5: edit/delete moved from an
    // always-visible footer text link to hover-revealed icon buttons that
    // live in the same header-row container as the status badge / resolve
    // toggle (design.md: headerEnd's `<span className="ms-auto ...">`).
    it('renders the edit/delete controls as icon buttons (material-symbols-outlined edit/delete glyphs), matching the CommentControl.tsx pattern', () => {
      currentUserRef.current = { _id: 'user1' };
      renderItem({ creatorId: 'user1' });

      const editButton = screen.getByTestId('inline-comment-edit-button');
      const deleteButton = screen.getByTestId('inline-comment-delete-button');

      expect(
        editButton.querySelector('.material-symbols-outlined'),
      ).toHaveTextContent('edit');
      expect(
        deleteButton.querySelector('.material-symbols-outlined'),
      ).toHaveTextContent('delete');
      // No more always-visible text-link markup left behind.
      expect(editButton).not.toHaveTextContent('Edit');
      expect(deleteButton).not.toHaveTextContent('Delete');
    });

    it('places the edit/delete icon buttons in the same header-row container as the status badge and resolve-toggle button (DOM structure)', () => {
      currentUserRef.current = { _id: 'user1' };
      const { container } = renderItem({ creatorId: 'user1' });

      const header = getMain(container)?.querySelector(
        '.d-flex.align-items-center',
      );
      const headerEnd = header?.querySelector('.ms-auto');
      expect(headerEnd).not.toBeNull();

      const editButton = screen.getByTestId('inline-comment-edit-button');
      const deleteButton = screen.getByTestId('inline-comment-delete-button');
      const badge = screen.getByTestId('inline-comment-status');
      const toggle = screen.getByRole('button', {
        name: 'inline_comment.resolve',
      });

      expect(headerEnd?.contains(editButton)).toBe(true);
      expect(headerEnd?.contains(deleteButton)).toBe(true);
      expect(headerEnd?.contains(badge)).toBe(true);
      expect(headerEnd?.contains(toggle)).toBe(true);
    });

    it('gives the icon-button container the hover-visibility CSS Modules class, scoped under the card root class (not display:none)', () => {
      currentUserRef.current = { _id: 'user1' };
      const { container } = renderItem({ creatorId: 'user1' });

      const editButton = screen.getByTestId('inline-comment-edit-button');
      const iconButtonContainer = editButton.closest('.icon-button-container');
      expect(iconButtonContainer).not.toBeNull();
      expect(
        container
          .querySelector('.inline-comment-item-styles')
          ?.contains(iconButtonContainer as Element),
      ).toBe(true);
      // display is never used for the hover toggle (would cause layout shift).
      expect(iconButtonContainer).not.toHaveStyle({ display: 'none' });
    });
  });
});
