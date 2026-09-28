// @vitest-environment happy-dom

/**
 * Unit tests for the content-preview + simple-reply popover shown when a
 * saved inline-comment highlight is hovered/clicked/tapped (design.md 決定2,
 * requirements.md Requirement 2, ACs 2.3/2.4/2.5).
 *
 * Positioning follows the exact same building blocks as `SelectionPopover`
 * (`rangeToVirtualElement` + `usePopperPosition`, portaled into
 * `document.body`), so `@popperjs/core` is mocked at the same low level as
 * `SelectionPopover.spec.tsx` -- the reference/popper elements actually
 * passed to `createPopper` are the only observable proving that wiring is
 * complete, not merely present.
 */

import { useEffect } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mock } from 'vitest-mock-extended';

import type { RendererOptions } from '~/interfaces/renderer-options';

import type {
  InlineCommentReply,
  InlineCommentWithReplies,
} from '../../../interfaces';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockCreatePopper = vi.fn(
  (_reference: unknown, _popper: unknown, _options: unknown) => ({
    destroy: vi.fn(),
    update: vi.fn(),
    setOptions: vi.fn(),
  }),
);

vi.mock('@popperjs/core', () => ({
  createPopper: (reference: unknown, popper: unknown, options: unknown) =>
    mockCreatePopper(reference, popper, options),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// `DeleteConfirmAlert` (reused for both the origin's and a reply's delete
// confirmation) reads `next-i18next`, not `react-i18next`.
vi.mock('next-i18next', () => ({
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

// The current user drives the author-only check for the edit affordance
// (`comment.creatorId === currentUser?._id`, same check
// `InlineCommentItem.tsx` uses). Mutable via `currentUserRef` so individual
// tests can simulate "viewing as the comment's own author" vs. "viewing as
// someone else".
const currentUserRef = vi.hoisted(
  () => ({ current: undefined }) as { current?: { _id: string } },
);
vi.mock('~/states/global', () => ({
  useCurrentUser: () => currentUserRef.current,
}));

// The read-only restriction is `NotAvailableIfReadOnlyUserNotAllowedToComment`'s
// own concern (it already has its own tests) -- mocked directly at the
// component boundary exactly as `InlineCommentItem.spec.tsx` mocks it, so a
// test here can assert "the popover's edit control is disabled under the
// read-only restriction" without re-deriving `NotAvailable`'s own DOM
// rendering.
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

// MentionAwareCommentInput owns a real CodeMirror editor assembly -- mocked
// at the component boundary exactly as InlineCommentItem.spec.tsx mocks it,
// so this file can drive an input's onSubmit without instantiating
// CodeMirror. Since the origin edit form, a reply's edit form, and the reply
// composer can all be mounted at once (2026-09-11 その4: the composer now
// uses this same input, not a plain `<textarea>`), instances are keyed by
// `editorKey` rather than kept in a single "last rendered" ref -- a single
// ref would silently point at whichever instance happened to render last.
const mentionAwareCommentInputInstances = vi.hoisted(
  () => new Map<string, Record<string, unknown>>(),
);
/**
 * The input hands `{ canSubmit, submit, insertMention }` outward through
 * `onControlsChange` and the caller renders the Save/Send button, so the
 * mock has to reproduce that handshake (from an effect, never during render
 * — calling the parent's setter mid-render is what would loop). Shared
 * across every instance: no test in this file exercises two of the input's
 * own controls at once, so one settable `canSubmit` plus one pair of spies
 * is enough to tell "which button was clicked" apart.
 */
const commentInputControls = vi.hoisted(() => ({
  canSubmit: true,
  submit: vi.fn(),
  insertMention: vi.fn(),
}));
vi.mock('../MentionAwareCommentInput/MentionAwareCommentInput', () => ({
  MentionAwareCommentInput: (props: Record<string, unknown>) => {
    const editorKey = props.editorKey as string;
    mentionAwareCommentInputInstances.set(editorKey, props);
    const onControlsChange = props.onControlsChange as
      | ((controls: unknown) => void)
      | undefined;
    useEffect(() => {
      onControlsChange?.({
        canSubmit: commentInputControls.canSubmit,
        submit: commentInputControls.submit,
        insertMention: commentInputControls.insertMention,
      });
    }, [onControlsChange]);
    return (
      <div
        data-testid="mention-aware-comment-input-mock"
        data-editor-key={editorKey}
      />
    );
  },
}));

// MentionPickerButton has its own spec; mocked at the boundary so this file
// only proves where the popover places it and that selecting a candidate
// reaches the input's insertMention control.
vi.mock('../InlineCommentForm/MentionPickerButton', () => ({
  MentionPickerButton: (props: { onInsert: (username: string) => void }) => (
    <button
      type="button"
      data-testid="mention-picker-button-mock"
      onClick={() => props.onInsert('alice')}
    >
      @
    </button>
  ),
}));

import { InlineCommentPreviewPopover } from './InlineCommentPreviewPopover';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const buildRect = (overrides: Partial<DOMRect> = {}): DOMRect =>
  ({
    x: 10,
    y: 20,
    width: 100,
    height: 16,
    top: 20,
    left: 10,
    right: 110,
    bottom: 36,
    toJSON: () => ({}),
    ...overrides,
  }) as DOMRect;

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

const reply = (
  overrides: Partial<InlineCommentReply> = {},
): InlineCommentReply => ({
  id: 'reply1',
  pageId: 'page1',
  creatorId: 'user2',
  creator: null,
  comment: 'an existing reply',
  replyToId: 'comment1',
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

const buildRange = (rect: DOMRect = buildRect()): Range =>
  mock<Range>({ getBoundingClientRect: vi.fn(() => rect) });

type PopoverHandlers = {
  createReply?: (parentId: string, comment: string) => Promise<unknown>;
  onClose?: () => void;
  resolve?: (id: string, resolved: boolean) => Promise<unknown>;
  update?: (id: string, comment: string) => Promise<unknown>;
  remove?: (id: string) => Promise<unknown>;
  updateReply?: (id: string, comment: string) => Promise<unknown>;
  removeReply?: (id: string) => Promise<unknown>;
  onPointerEnter?: () => void;
};

const renderPopover = (
  overrides: Partial<InlineCommentWithReplies> = {},
  handlers: PopoverHandlers = {},
  range: Range = buildRange(),
) =>
  render(
    <InlineCommentPreviewPopover
      comment={originComment(overrides)}
      range={range}
      rendererOptions={rendererOptions}
      createReply={handlers.createReply ?? vi.fn().mockResolvedValue(undefined)}
      onClose={handlers.onClose ?? vi.fn()}
      resolve={handlers.resolve ?? vi.fn().mockResolvedValue(undefined)}
      update={handlers.update ?? vi.fn().mockResolvedValue(undefined)}
      remove={handlers.remove ?? vi.fn().mockResolvedValue(undefined)}
      updateReply={handlers.updateReply ?? vi.fn().mockResolvedValue(undefined)}
      removeReply={handlers.removeReply ?? vi.fn().mockResolvedValue(undefined)}
      onPointerEnter={handlers.onPointerEnter ?? vi.fn()}
    />,
  );

describe('InlineCommentPreviewPopover', () => {
  beforeEach(() => {
    mockCreatePopper.mockClear();
    currentUserRef.current = undefined;
    mentionAwareCommentInputInstances.clear();
    isDisabledRef.current = false;
    commentInputControls.canSubmit = true;
    commentInputControls.submit.mockReset();
    commentInputControls.insertMention.mockReset();
  });

  it('renders its content through a portal into document.body, positioned via the popper mechanism', () => {
    const { container } = renderPopover();

    const popover = screen.getByTestId('inline-comment-preview-popover');
    expect(document.body).toContainElement(popover);
    expect(container).not.toContainElement(popover);
    expect(mockCreatePopper).toHaveBeenCalledTimes(1);
  });

  it('shows the author, posted date, and body of the origin comment (Req 2.1)', () => {
    renderPopover({ comment: 'the comment body' });

    const popover = screen.getByTestId('inline-comment-preview-popover');
    // Scoped to the origin comment's own header row by test id, not by class:
    // the reply composer also renders a UserPicture inside a
    // `d-flex align-items-center` row, so a class-based query here would
    // depend on document order rather than on the header actually being the
    // element it found.
    const header = screen.getByTestId('inline-comment-preview-popover-header');
    expect(header.querySelector('[data-testid="user-picture"]')).not.toBeNull();
    expect(header.querySelector('[data-testid="username"]')).not.toBeNull();
    expect(
      header.querySelector('[data-testid="formatted-distance-date"]'),
    ).not.toBeNull();
    expect(popover).toHaveTextContent('the comment body');
  });

  // 2026-09-11 design change: the origin comment
  // is no longer rendered through `CommentCard`. The list item keeps reusing
  // it; the popover builds its own header/body so the popover can carry the
  // mockup's own surface treatment instead of the shared comment box
  // (gray `bg-comment` fill, speech-bubble triangle, 6px corners).
  it('renders the origin comment outside the shared CommentCard box', () => {
    renderPopover();

    const origin = screen.getByTestId('inline-comment-preview-popover-origin');
    expect(origin.closest('.page-comment')).toBeNull();
    expect(origin.querySelector('.page-comment-main')).toBeNull();
    expect(origin.querySelector('.bg-comment')).toBeNull();

    // The body keeps an identity of its own now that `.page-comment-body`
    // (CommentCard's) belongs to the replies only.
    const body = screen.getByTestId('inline-comment-preview-popover-body');
    expect(origin).toContainElement(body);
    expect(body).toHaveTextContent('the comment body');
    expect(body.classList.contains('page-comment-body')).toBe(false);
  });

  // 2026-09-11 その2: a reply is no
  // longer a boxed `CommentCard` either -- origin and reply now share the
  // same flat markup, so the only thing that still distinguishes them in the
  // popover is the quote block the origin carries.
  it('renders replies with the same flat markup as the origin, not a CommentCard box', () => {
    renderPopover({ replies: [reply({ comment: 'an existing reply' })] });

    const replyElement = screen.getByTestId(
      'inline-comment-preview-popover-reply',
    );
    expect(replyElement.querySelector('.page-comment')).toBeNull();
    expect(replyElement.querySelector('.page-comment-main')).toBeNull();
    expect(replyElement.querySelector('.bg-comment')).toBeNull();
    expect(replyElement.querySelector('.page-comment-body')).toBeNull();

    // Author, date and body are all still there.
    const header = replyElement.querySelector(
      '[data-testid="inline-comment-preview-popover-reply-header"]',
    );
    expect(
      header?.querySelector('[data-testid="user-picture"]'),
    ).not.toBeNull();
    expect(header?.querySelector('[data-testid="username"]')).not.toBeNull();
    expect(
      header?.querySelector('[data-testid="formatted-distance-date"]'),
    ).not.toBeNull();
    expect(
      replyElement.querySelector(
        '[data-testid="inline-comment-preview-popover-reply-body"]',
      ),
    ).toHaveTextContent('an existing reply');
  });

  it('gives a reply no quote block and no resolve toggle of its own', () => {
    renderPopover({ replies: [reply()] });

    const replyElement = screen.getByTestId(
      'inline-comment-preview-popover-reply',
    );
    expect(replyElement.querySelector('.inline-comment-quote')).toBeNull();
    expect(
      screen.getAllByRole('button', { name: 'inline_comment.resolve' }),
    ).toHaveLength(1);
  });

  it('gives the popover itself the mockup card treatment with semantic utility classes only (Req 2.1, 3.1)', () => {
    renderPopover();

    const popover = screen.getByTestId('inline-comment-preview-popover');
    // `card` supplies the surface background and the 1px border; the radius
    // and the diffuse drop shadow are the mockup's own `--radius-lg` /
    // `--shadow` approximated by Bootstrap's own scale (Requirement 3.1: no
    // hardcoded hex, no bespoke shadow).
    expect(popover).toHaveClass('card', 'rounded-4', 'shadow');
  });

  it('shows the existing replies (Req 2.1)', () => {
    renderPopover({
      replies: [
        reply({ id: 'reply1', comment: 'an existing reply' }),
        reply({ id: 'reply2', comment: 'a second reply' }),
      ],
    });

    const popover = screen.getByTestId('inline-comment-preview-popover');
    expect(popover).toHaveTextContent('an existing reply');
    expect(popover).toHaveTextContent('a second reply');
    expect(
      screen.getAllByTestId('inline-comment-preview-popover-reply'),
    ).toHaveLength(2);
  });

  // 2026-09-11: `replies` arrives in the server's `createdAt: 'desc'` fetch
  // order (newest first) -- InlineCommentService.listByPageId() never
  // reorders for display, display order is this component's own concern.
  // Mirrors InlineCommentReplies.tsx's own `repliesFromOldest` reversal (user
  // report: replies were rendering newest-first, oldest-last).
  it('renders replies oldest-first even though the `replies` prop arrives newest-first (Req 2.1)', () => {
    renderPopover({
      replies: [
        reply({
          id: 'reply-newer',
          comment: 'the newer reply',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
        reply({
          id: 'reply-older',
          comment: 'the older reply',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
    });

    const renderedReplies = screen.getAllByTestId(
      'inline-comment-preview-popover-reply',
    );
    expect(renderedReplies[0]).toHaveTextContent('the older reply');
    expect(renderedReplies[1]).toHaveTextContent('the newer reply');
  });

  // 2026-09-11 その4: the reply composer is `MentionAwareCommentInput`, same
  // as every other comment input in this feature -- draft text, the empty/
  // whitespace-only submit guard, clearing on success, and error display on
  // rejection are all that component's own contract (covered by
  // MentionAwareCommentInput.spec.tsx). This file's own contract is only the
  // wiring: which id the popover passes to `createReply`, and that the send
  // button reflects the input's own `canSubmit`.
  it('wires the reply composer submit to createReply with the comment id (Req 2.3)', async () => {
    const createReply = vi.fn().mockResolvedValue(undefined);
    renderPopover({ id: 'comment42' }, { createReply });

    const composerInput = mentionAwareCommentInputInstances.get(
      'inline_comment_preview_popover_new_reply_comment42',
    );

    await act(async () => {
      await (composerInput?.onSubmit as (text: string) => Promise<unknown>)(
        'a quick reply',
      );
    });

    expect(createReply).toHaveBeenCalledWith('comment42', 'a quick reply');
  });

  it('disables the send button while the reply composer reports it cannot submit (Req 2.3)', () => {
    commentInputControls.canSubmit = false;
    renderPopover();

    expect(
      screen.getByRole('button', { name: 'page_comment.comment' }),
    ).toBeDisabled();
  });

  it('invokes the composer submit control when the send button is clicked (Req 15.3)', async () => {
    renderPopover();

    await userEvent.click(
      screen.getByRole('button', { name: 'page_comment.comment' }),
    );

    expect(commentInputControls.submit).toHaveBeenCalledTimes(1);
  });

  it("hides the edit affordance when the current user is not the comment's own creator", () => {
    currentUserRef.current = { _id: 'someone-else' };
    renderPopover({ creatorId: 'user1' });

    expect(
      screen.queryByTestId('inline-comment-preview-popover-edit-button'),
    ).not.toBeInTheDocument();
  });

  it('hides the edit affordance when there is no current user', () => {
    currentUserRef.current = undefined;
    renderPopover({ creatorId: 'user1' });

    expect(
      screen.queryByTestId('inline-comment-preview-popover-edit-button'),
    ).not.toBeInTheDocument();
  });

  it('disables the edit control under the read-only restriction (Requirement 18, AC 18.4)', () => {
    currentUserRef.current = { _id: 'user1' };
    isDisabledRef.current = true;
    renderPopover({ creatorId: 'user1' });

    // Scoped via `.closest()` from the edit button itself, not a bare
    // `getByTestId('not-available-for-read-only-user')`: the resolve toggle
    // and the reply composer (inline-comment-readonly-restriction Req 2.2,
    // 2.3) now render their own guards at the same time.
    const editButton = screen.getByTestId(
      'inline-comment-preview-popover-edit-button',
    );
    expect(
      editButton.closest('[data-testid="not-available-for-read-only-user"]'),
    ).not.toBeNull();
    expect(editButton).toBeDisabled();
  });

  it("shows the edit affordance and updates the origin comment through `update` when the current user is the comment's own creator (Requirement 15, AC 15.5)", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    currentUserRef.current = { _id: 'user1' };
    renderPopover({ id: 'comment42', creatorId: 'user1' }, { update });

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-edit-button'),
    );

    const originEditorKey = 'inline_comment_preview_popover_edit_comment42';
    expect(
      mentionAwareCommentInputInstances.get(originEditorKey),
    ).toBeDefined();
    expect(
      mentionAwareCommentInputInstances.get(originEditorKey)?.initialValue,
    ).toBe('the comment body');

    await act(async () => {
      await (
        mentionAwareCommentInputInstances.get(originEditorKey)?.onSubmit as (
          text: string,
        ) => Promise<unknown>
      )('the edited comment body');
    });

    expect(update).toHaveBeenCalledWith('comment42', 'the edited comment body');
    await waitFor(() => {
      expect(
        screen.queryByTestId('inline-comment-preview-popover-edit-form'),
      ).not.toBeInTheDocument();
    });
  });

  it('wraps the edit-mode input in an accent-colored border using semantic Bootstrap classes (Req 2.2, 3.1)', async () => {
    currentUserRef.current = { _id: 'user1' };
    renderPopover({ id: 'comment42', creatorId: 'user1' });

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-edit-button'),
    );

    const editForm = screen.getByTestId(
      'inline-comment-preview-popover-edit-form',
    );
    // Semantic Bootstrap accent-border utility classes only -- no hardcoded
    // hex color, no inline style (Requirement 3.1).
    expect(editForm).toHaveClass('border', 'border-primary', 'rounded');
    expect(editForm.getAttribute('style')).toBeFalsy();
  });

  it('places the Cancel button below the input, right-aligned (Req 2.2)', async () => {
    currentUserRef.current = { _id: 'user1' };
    renderPopover({ id: 'comment42', creatorId: 'user1' });

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-edit-button'),
    );

    const cancelButton = screen.getByTestId(
      'inline-comment-preview-popover-edit-cancel-button',
    );
    const actionsRow = cancelButton.parentElement;
    expect(actionsRow).toHaveClass('d-flex', 'justify-content-end');
  });

  // Save joins Cancel in that same row, in the same order, so the popover's
  // edit mode reads the same way as the list item's own edit mode.
  it('places Cancel and Save together in that row, Cancel first', async () => {
    currentUserRef.current = { _id: 'user1' };
    renderPopover({ id: 'comment42', creatorId: 'user1' });

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-edit-button'),
    );

    const cancelButton = screen.getByTestId(
      'inline-comment-preview-popover-edit-cancel-button',
    );
    const saveButton = screen.getByTestId(
      'inline-comment-preview-popover-edit-save-button',
    );
    const actionsRow = cancelButton.parentElement;

    expect(saveButton.parentElement).toBe(actionsRow);
    expect(actionsRow).toHaveClass('d-flex', 'justify-content-end', 'gap-2');
    expect(
      cancelButton.compareDocumentPosition(saveButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const editForm = screen.getByTestId(
      'inline-comment-preview-popover-edit-form',
    );
    const input = within(editForm).getByTestId(
      'mention-aware-comment-input-mock',
    );
    expect(
      input.compareDocumentPosition(actionsRow as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(saveButton).toHaveClass('btn', 'btn-sm', 'btn-primary');
  });

  it('puts the mention picker in that same row, left of Cancel and Save', async () => {
    currentUserRef.current = { _id: 'user1' };
    renderPopover({ id: 'comment42', creatorId: 'user1' });

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-edit-button'),
    );

    const editForm = screen.getByTestId(
      'inline-comment-preview-popover-edit-form',
    );
    const picker = within(editForm).getByTestId('mention-picker-button-mock');
    const cancelButton = screen.getByTestId(
      'inline-comment-preview-popover-edit-cancel-button',
    );
    const actionsRow = cancelButton.parentElement as HTMLElement;
    expect(actionsRow.contains(picker)).toBe(true);
    expect(
      picker.compareDocumentPosition(cancelButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await userEvent.click(picker);
    expect(commentInputControls.insertMention).toHaveBeenCalledWith('alice');
  });

  it("invokes the input's submit control when Save is clicked", async () => {
    currentUserRef.current = { _id: 'user1' };
    renderPopover({ id: 'comment42', creatorId: 'user1' });

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-edit-button'),
    );
    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-edit-save-button'),
    );

    expect(commentInputControls.submit).toHaveBeenCalledTimes(1);
  });

  it('disables Save while the input reports it cannot submit (empty text)', async () => {
    commentInputControls.canSubmit = false;
    currentUserRef.current = { _id: 'user1' };
    renderPopover({ id: 'comment42', creatorId: 'user1' });

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-edit-button'),
    );

    expect(
      screen.getByTestId('inline-comment-preview-popover-edit-save-button'),
    ).toBeDisabled();
  });

  // 2026-09-11 その2: editing the origin used to be
  // guarded as `!isEditing && (<>replies + reply form</>)`, which made the
  // whole thread vanish as soon as the origin was edited. Each entry now owns
  // its own edit state, so only the edited body is replaced.
  it('keeps the reply thread and the reply form on screen while the origin is being edited', async () => {
    currentUserRef.current = { _id: 'user1' };
    renderPopover({
      id: 'comment42',
      creatorId: 'user1',
      replies: [reply({ replyToId: 'comment42', comment: 'a reply' })],
    });

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-edit-button'),
    );

    // The origin is in edit mode...
    expect(
      screen.getByTestId('inline-comment-preview-popover-edit-form'),
    ).toBeInTheDocument();
    // ...and the thread below it is untouched.
    expect(
      screen.getByTestId('inline-comment-preview-popover-replies'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('inline-comment-preview-popover-reply'),
    ).toHaveTextContent('a reply');
    expect(
      document.querySelector('.inline-comment-preview-popover-reply-form'),
    ).not.toBeNull();
  });

  it("editing a reply leaves the origin's body and the other replies displayed", async () => {
    currentUserRef.current = { _id: 'user2' };
    renderPopover({
      id: 'comment42',
      creatorId: 'user1',
      // Given in the server's own desc (newest-first) fetch order; the
      // component reverses to oldest-first for display.
      replies: [
        reply({
          id: 'reply2',
          creatorId: 'user2',
          comment: 'the other reply',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
        reply({
          id: 'reply1',
          creatorId: 'user2',
          comment: 'the first reply',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
    });

    // Displayed oldest-first, so `editButtons[0]` is still "the first reply".
    const editButtons = screen.getAllByTestId(
      'inline-comment-preview-popover-reply-edit-button',
    );
    expect(editButtons).toHaveLength(2);
    await userEvent.click(editButtons[0]);

    // Exactly one reply is being edited -- scoped to the replies container so
    // the always-mounted reply composer's own MentionAwareCommentInput
    // instance (2026-09-11 その4) doesn't get counted as a second "editor".
    expect(
      within(
        screen.getByTestId('inline-comment-preview-popover-replies'),
      ).getAllByTestId('mention-aware-comment-input-mock'),
    ).toHaveLength(1);
    expect(
      screen.getByTestId('inline-comment-preview-popover-body'),
    ).toHaveTextContent('the comment body');
    expect(
      screen.getByTestId('inline-comment-preview-popover'),
    ).toHaveTextContent('the other reply');
    expect(
      document.querySelector('.inline-comment-preview-popover-reply-form'),
    ).not.toBeNull();
  });

  it("shows a reply's edit/delete affordances only to that reply's own creator (Req 1.6, 2.6)", () => {
    currentUserRef.current = { _id: 'user2' };
    renderPopover({
      creatorId: 'user1',
      replies: [
        reply({ id: 'reply1', creatorId: 'user2' }),
        reply({ id: 'reply2', creatorId: 'someone-else' }),
      ],
    });

    expect(
      screen.getAllByTestId('inline-comment-preview-popover-reply-edit-button'),
    ).toHaveLength(1);
    expect(
      screen.getAllByTestId(
        'inline-comment-preview-popover-reply-delete-button',
      ),
    ).toHaveLength(1);
  });

  it("disables a reply's edit/delete controls under the read-only-user restriction (Req 1.6)", () => {
    currentUserRef.current = { _id: 'user2' };
    isDisabledRef.current = true;
    renderPopover({ replies: [reply({ creatorId: 'user2' })] });

    expect(
      screen.getByTestId('inline-comment-preview-popover-reply-edit-button'),
    ).toBeDisabled();
    expect(
      screen.getByTestId('inline-comment-preview-popover-reply-delete-button'),
    ).toBeDisabled();
  });

  it("persists an edited reply through updateReply with that reply's id (Req 2.6)", async () => {
    const updateReply = vi.fn().mockResolvedValue(undefined);
    currentUserRef.current = { _id: 'user2' };
    renderPopover(
      { replies: [reply({ id: 'reply7', creatorId: 'user2' })] },
      { updateReply },
    );

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-reply-edit-button'),
    );
    const replyEditorKey = 'inline_comment_preview_popover_reply_edit_reply7';
    expect(
      mentionAwareCommentInputInstances.get(replyEditorKey)?.initialValue,
    ).toBe('an existing reply');

    await act(async () => {
      await (
        mentionAwareCommentInputInstances.get(replyEditorKey)?.onSubmit as (
          text: string,
        ) => Promise<unknown>
      )('the edited reply');
    });

    expect(updateReply).toHaveBeenCalledWith('reply7', 'the edited reply');
  });

  it("deletes a reply through removeReply with that reply's id, after confirmation (Req 2.6)", async () => {
    const removeReply = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    currentUserRef.current = { _id: 'user2' };
    renderPopover(
      { replies: [reply({ id: 'reply7', creatorId: 'user2' })] },
      { removeReply, onClose },
    );

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-reply-delete-button'),
    );
    expect(removeReply).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByTestId(
        'inline-comment-preview-popover-reply-delete-confirm-button',
      ),
    );

    expect(removeReply).toHaveBeenCalledWith('reply7');
    // Deleting a reply is not a reason to close the popover -- the thread it
    // belonged to is still there.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not delete a reply when the confirmation is cancelled (Req 2.6)', async () => {
    const removeReply = vi.fn();
    currentUserRef.current = { _id: 'user2' };
    renderPopover(
      { replies: [reply({ creatorId: 'user2' })] },
      { removeReply },
    );

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-reply-delete-button'),
    );
    await userEvent.click(
      screen.getByTestId(
        'inline-comment-preview-popover-reply-delete-cancel-button',
      ),
    );

    expect(removeReply).not.toHaveBeenCalled();
  });

  it('places the close button as the last element of the header row, not absolutely positioned over the card corner', () => {
    currentUserRef.current = { _id: 'user1' };
    renderPopover({ creatorId: 'user1' });

    const closeButton = screen.getByTestId(
      'inline-comment-preview-popover-close-button',
    );
    // It used to be `position-absolute top-0 end-0` on the card body, which
    // put it above the header row in the card's own top padding, where it
    // collided with the popover's rounded corner.
    expect(closeButton).not.toHaveClass('position-absolute');

    // `closest`, not the render result's `container`: this popover renders
    // through a portal into `document.body`, so it is not inside `container`.
    const headerEnd = closeButton.closest('.ms-auto');
    expect(headerEnd).not.toBeNull();
    expect(headerEnd?.lastElementChild).toBe(closeButton);
    // The row the controls sit in is the origin comment's own header row.
    // (Before the 2026-09-11 redesign this was `CommentCard`'s
    // `.page-comment-main` header; the popover now builds its own.)
    expect(
      headerEnd?.closest(
        '[data-testid="inline-comment-preview-popover-header"]',
      ),
    ).not.toBeNull();
  });

  // Requirement 2.6 retracts AC 2.4 ("no delete in the popover"): the origin
  // comment is now deletable here too, so the popover and the list item offer
  // the same set of actions.
  it('deletes the origin comment through `remove` after confirmation, then closes the popover (Req 2.6)', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    currentUserRef.current = { _id: 'user1' };
    renderPopover({ id: 'comment42', creatorId: 'user1' }, { remove, onClose });

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-delete-button'),
    );
    expect(remove).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByTestId(
        'inline-comment-preview-popover-delete-confirm-button',
      ),
    );

    expect(remove).toHaveBeenCalledWith('comment42');
    // Nothing is left for the popover to show once its origin comment is
    // gone, so it closes itself rather than waiting for the refetch to make
    // the comment disappear from the caller's list.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the popover open and shows the error when deleting the origin comment fails (Req 2.6)', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('permission denied'));
    const onClose = vi.fn();
    currentUserRef.current = { _id: 'user1' };
    renderPopover({ creatorId: 'user1' }, { remove, onClose });

    await userEvent.click(
      screen.getByTestId('inline-comment-preview-popover-delete-button'),
    );
    await userEvent.click(
      screen.getByTestId(
        'inline-comment-preview-popover-delete-confirm-button',
      ),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('inline-comment-preview-popover-delete-error'),
      ).toHaveTextContent('permission denied');
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("hides the origin's delete affordance from a viewer who is not its creator", () => {
    currentUserRef.current = { _id: 'someone-else' };
    renderPopover({ creatorId: 'user1' });

    expect(
      screen.queryByTestId('inline-comment-preview-popover-delete-button'),
    ).not.toBeInTheDocument();
  });

  // Every icon button in the popover is a 32px
  // square now, following the user's own `be49248348` / `6ef7593ce8`.
  it('has no circular icon buttons left anywhere in the popover', () => {
    currentUserRef.current = { _id: 'user1' };
    renderPopover({
      creatorId: 'user1',
      replies: [reply({ creatorId: 'user1' })],
    });

    const popover = screen.getByTestId('inline-comment-preview-popover');
    expect(popover.querySelectorAll('button.rounded-circle')).toHaveLength(0);
  });

  // 2026-09-11 design change (status badge removed):
  // the status badge is gone from the popover in both states -- the resolve
  // toggle alone carries the state, since its own label already says which
  // way the state will go. The list item keeps its badge.
  it('shows no status badge in either state', () => {
    const { rerender } = renderPopover({ resolvedAt: null });

    expect(
      screen.queryByTestId('inline-comment-status'),
    ).not.toBeInTheDocument();

    rerender(
      <InlineCommentPreviewPopover
        comment={originComment({
          resolvedAt: new Date('2026-01-03T00:00:00.000Z'),
        })}
        range={buildRange()}
        rendererOptions={rendererOptions}
        createReply={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        resolve={vi.fn().mockResolvedValue(undefined)}
        update={vi.fn().mockResolvedValue(undefined)}
        remove={vi.fn().mockResolvedValue(undefined)}
        updateReply={vi.fn().mockResolvedValue(undefined)}
        removeReply={vi.fn().mockResolvedValue(undefined)}
        onPointerEnter={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId('inline-comment-status'),
    ).not.toBeInTheDocument();
    // The state is still reachable: the toggle's own label switches.
    expect(
      screen.getByRole('button', { name: 'inline_comment.reopen' }),
    ).toBeInTheDocument();
  });

  it('gives the resolve-toggle button the same rounded-pill class composition as the list item (Req 2.3)', () => {
    renderPopover({ resolvedAt: null });

    const toggleButton = screen.getByRole('button', {
      name: 'inline_comment.resolve',
    });
    expect(toggleButton).toHaveClass(
      'btn',
      'btn-sm',
      'btn-outline-secondary',
      'rounded-pill',
    );
  });

  // inline-comment-readonly-restriction Requirement 2.3, 2.4: the resolve
  // toggle gets the same read-only-user guard the edit/delete controls
  // already have (Design File Structure Plan, InlineCommentPreviewPopover.tsx
  // item (1)). Scoped via `.closest()` from the toggle button itself, not a
  // bare `getByTestId('not-available-for-read-only-user')`, because the
  // origin entry's own edit/delete guard (InlineCommentPopoverEntry.tsx,
  // unmocked here) and the reply-form guard can render at the same time.
  it('disables the resolve toggle under the read-only restriction (inline-comment-readonly-restriction Req 2.3, 2.4)', () => {
    isDisabledRef.current = true;
    renderPopover({ resolvedAt: null });

    const toggleButton = screen.getByTestId(
      'inline-comment-preview-popover-resolve-toggle-button',
    );
    expect(toggleButton).toBeDisabled();
    expect(
      toggleButton.closest('[data-testid="not-available-for-read-only-user"]'),
    ).not.toBeNull();
  });

  it('keeps the resolve toggle enabled when the read-only restriction does not apply (inline-comment-readonly-restriction Req 2.4)', () => {
    isDisabledRef.current = false;
    renderPopover({ resolvedAt: null });

    expect(
      screen.getByTestId(
        'inline-comment-preview-popover-resolve-toggle-button',
      ),
    ).not.toBeDisabled();
  });

  // inline-comment-readonly-restriction Requirement 2.2, 2.4: the whole reply
  // composer (avatar + input + mention picker + send button) is wrapped as a
  // single unit -- there is no open/closed toggle stage in this popover, so
  // the guard has to cover the always-shown form entirely (Design File
  // Structure Plan, InlineCommentPreviewPopover.tsx item (2)).
  it('disables the reply composer under the read-only restriction (inline-comment-readonly-restriction Req 2.2, 2.4)', () => {
    isDisabledRef.current = true;
    renderPopover();

    const composer = document.querySelector(
      '.inline-comment-preview-popover-reply-form',
    ) as HTMLElement;
    const guard = composer.closest(
      '[data-testid="not-available-for-read-only-user"]',
    );
    expect(guard).not.toBeNull();

    const sendButton = within(composer).getByRole('button', {
      name: 'page_comment.comment',
    });
    expect(sendButton).toBeDisabled();
  });

  it('keeps the reply composer usable when the read-only restriction does not apply (inline-comment-readonly-restriction Req 2.4)', () => {
    isDisabledRef.current = false;
    renderPopover();

    const composer = document.querySelector(
      '.inline-comment-preview-popover-reply-form',
    ) as HTMLElement;
    expect(
      composer.closest('[data-testid="not-available-for-read-only-user"]'),
    ).toBeNull();
    expect(
      within(composer).getByRole('button', { name: 'page_comment.comment' }),
    ).not.toBeDisabled();
  });

  // The close button must remain reachable in every mode -- same invariant
  // InlineCommentPopoverEntry.tsx's own headerExtra comment states for the
  // edit/delete guard. Only this guard covers the resolve toggle; the close
  // button sits outside it.
  it('never disables the close button, even when the read-only restriction applies (inline-comment-readonly-restriction Req 2.3)', () => {
    isDisabledRef.current = true;
    renderPopover({ creatorId: 'user1' });

    const closeButton = screen.getByTestId(
      'inline-comment-preview-popover-close-button',
    );
    expect(closeButton).not.toBeDisabled();
    expect(
      closeButton.closest('[data-testid="not-available-for-read-only-user"]'),
    ).toBeNull();
  });

  it('closes on an explicit close-button click (Req 2.4)', async () => {
    const onClose = vi.fn();
    renderPopover({}, { onClose });

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when clicking outside the popover (Req 2.4)', () => {
    const onClose = vi.fn();
    renderPopover({}, { onClose });

    // Outside the portal entirely.
    const outsideNode = document.createElement('div');
    document.body.appendChild(outsideNode);

    outsideNode.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(1);

    document.body.removeChild(outsideNode);
  });

  it('does not close when clicking inside the popover', async () => {
    const onClose = vi.fn();
    renderPopover({}, { onClose });

    const composer = document.querySelector(
      '.inline-comment-preview-popover-reply-form',
    ) as HTMLElement;
    await userEvent.click(composer);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders a Resolve control for an unresolved comment, and toggles to resolved on click (Req 4.6)', async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    renderPopover({ id: 'comment42', resolvedAt: null }, { resolve });

    await userEvent.click(
      screen.getByRole('button', { name: 'inline_comment.resolve' }),
    );

    expect(resolve).toHaveBeenCalledWith('comment42', true);
  });

  it('renders a Reopen control for a resolved comment, and toggles to unresolved on click (Req 4.6)', async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    renderPopover(
      { id: 'comment42', resolvedAt: new Date('2026-01-03T00:00:00.000Z') },
      { resolve },
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'inline_comment.reopen' }),
    );

    expect(resolve).toHaveBeenCalledWith('comment42', false);
  });

  it('displays an error when the resolve toggle rejects, without closing the popover (Req 4.6)', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('permission denied'));
    const onClose = vi.fn();
    renderPopover({ resolvedAt: null }, { resolve, onClose });

    await userEvent.click(
      screen.getByRole('button', { name: 'inline_comment.resolve' }),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('inline-comment-resolve-error'),
      ).toHaveTextContent('permission denied');
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('updates the displayed resolved state after a successful toggle (Req 4.6)', async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    renderPopover({ resolvedAt: null }, { resolve });

    await userEvent.click(
      screen.getByRole('button', { name: 'inline_comment.resolve' }),
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId('inline-comment-resolve-error'),
      ).not.toBeInTheDocument();
    });
  });

  it('calls onPointerEnter when the pointer enters the popover root (Req 15.9)', () => {
    const onPointerEnter = vi.fn();
    renderPopover({}, { onPointerEnter });

    const popover = screen.getByTestId('inline-comment-preview-popover');
    fireEvent.mouseEnter(popover);

    expect(onPointerEnter).toHaveBeenCalledTimes(1);
  });

  it('renders the anchored quote in a strip visually distinct from the comment body (Req 15.11)', () => {
    renderPopover({
      comment: 'the comment body',
      anchor: {
        quote: 'the quoted range',
        prefix: '',
        suffix: '',
        approxOffset: 0,
      },
    });

    const popover = screen.getByTestId('inline-comment-preview-popover');
    const quoteStrip = screen.getByTestId(
      'inline-comment-preview-popover-quote',
    );

    expect(popover).toContainElement(quoteStrip);
    expect(quoteStrip).toHaveTextContent('the quoted range');
    // Distinct from the comment body: the quote text never appears inside
    // the body's own rendered markdown.
    expect(quoteStrip).not.toHaveTextContent('the comment body');
  });

  it('unifies the quote block class composition with the list item (Req 1.7) and drops the inline style', () => {
    renderPopover({
      anchor: {
        quote: 'the quoted range',
        prefix: '',
        suffix: '',
        approxOffset: 0,
      },
    });

    const quoteStrip = screen.getByTestId(
      'inline-comment-preview-popover-quote',
    );

    // Same left-border/background class composition as InlineCommentItem's
    // own quote block -- the accent-colored left border comes from the
    // shared `.inline-comment-quote` rule (border-left:
    // var(--grw-inline-comment-marker-bg)), not from a component-local color.
    expect(quoteStrip).toHaveClass('inline-comment-quote', 'bg-body-tertiary');
    // The 2-line clamp must now be expressed as a CSS Modules class, not an
    // inline style attribute (Requirement 3.3).
    expect(quoteStrip.getAttribute('style')).toBeFalsy();
  });

  // 2026-09-11 その4: the pill-shaped plain `<textarea>` was replaced by the
  // same `MentionAwareCommentInput` + `MentionPickerButton` pairing every
  // other comment input in this feature uses, so a mention picker button is
  // available here too (the user's own request: "reply-form にも mention
  // picker button ほしいですね").
  it('renders the reply composer as an avatar + mention-aware input + mention-picker + send button row (Req 15.3, 2.7)', () => {
    renderPopover();

    // Scoped to the composer row itself, not the whole popover -- the origin
    // comment's own header already renders a (mocked) user-picture, so
    // asserting against the full popover would pass even without the
    // composer's own avatar.
    const composer = document.querySelector(
      '.inline-comment-preview-popover-reply-form',
    ) as HTMLElement;

    expect(composer).not.toBeNull();
    expect(within(composer).getByTestId('user-picture')).toBeInTheDocument();
    expect(
      within(composer).getByTestId('mention-aware-comment-input-mock'),
    ).toBeInTheDocument();
    expect(
      within(composer).getByTestId('mention-picker-button-mock'),
    ).toBeInTheDocument();
    expect(
      within(composer).getByRole('button', { name: 'page_comment.comment' }),
    ).toBeInTheDocument();
  });

  it('wires the mention picker next to the send button to the composer insertMention control (Req 2.7)', async () => {
    renderPopover();

    const composer = document.querySelector(
      '.inline-comment-preview-popover-reply-form',
    ) as HTMLElement;
    const picker = within(composer).getByTestId('mention-picker-button-mock');

    await userEvent.click(picker);

    expect(commentInputControls.insertMention).toHaveBeenCalledWith('alice');
  });
});
