// @vitest-environment happy-dom

/**
 * Unit tests for the popover's shared "one displayed comment" component, used
 * by both the origin comment and every reply,
 * requirements.md Requirement 2, ACs 2.1/2.2/2.6).
 *
 * The two callers differ only in what they pass: the origin adds a quote
 * block (`beforeBody`) and the resolve/close controls (`headerExtra`), and
 * each uses its own `testIdPrefix`. Everything else -- the header row, the
 * author-only edit/delete affordances, the edit mode and the delete
 * confirmation -- is this component's own contract and is what this file
 * covers.
 */

import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { RendererOptions } from '~/interfaces/renderer-options';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// `DeleteConfirmAlert` reads `next-i18next`, not `react-i18next`.
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

const mentionAwareCommentInputProps = vi.hoisted(
  () => ({ current: undefined }) as { current?: Record<string, unknown> },
);
const commentInputControls = vi.hoisted(() => ({
  canSubmit: true,
  submit: vi.fn(),
  insertMention: vi.fn(),
}));
vi.mock('../MentionAwareCommentInput/MentionAwareCommentInput', () => ({
  MentionAwareCommentInput: (props: Record<string, unknown>) => {
    mentionAwareCommentInputProps.current = props;
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
    return <div data-testid="mention-aware-comment-input-mock" />;
  },
}));

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

import { InlineCommentPopoverEntry } from './InlineCommentPopoverEntry';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const rendererOptions: RendererOptions = {
  remarkPlugins: [],
  rehypePlugins: [],
  components: {},
};

const TEST_ID_PREFIX = 'entry';

type RenderOverrides = {
  isOwn?: boolean;
  commentText?: string;
  rendererOptions?: RendererOptions | undefined;
  onUpdate?: (text: string) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
  beforeBody?: React.ReactNode;
  headerExtra?: React.ReactNode;
};

const renderEntry = (overrides: RenderOverrides = {}) =>
  render(
    <InlineCommentPopoverEntry
      id="comment1"
      creator={null}
      createdAt={new Date('2026-01-01T00:00:00.000Z')}
      commentText={overrides.commentText ?? 'the comment body'}
      rendererOptions={
        'rendererOptions' in overrides
          ? overrides.rendererOptions
          : rendererOptions
      }
      isOwn={overrides.isOwn ?? true}
      editorKeyPrefix="entry_edit"
      onUpdate={overrides.onUpdate ?? vi.fn().mockResolvedValue(undefined)}
      onRemove={overrides.onRemove ?? vi.fn().mockResolvedValue(undefined)}
      beforeBody={overrides.beforeBody}
      headerExtra={overrides.headerExtra}
      testIdPrefix={TEST_ID_PREFIX}
    />,
  );

describe('InlineCommentPopoverEntry', () => {
  beforeEach(() => {
    isDisabledRef.current = false;
    mentionAwareCommentInputProps.current = undefined;
    commentInputControls.canSubmit = true;
    commentInputControls.submit.mockReset();
    commentInputControls.insertMention.mockReset();
  });

  it('shows the author, posted date and body (Req 2.1)', () => {
    renderEntry({ commentText: 'the comment body' });

    const header = screen.getByTestId(`${TEST_ID_PREFIX}-header`);
    expect(header.querySelector('[data-testid="user-picture"]')).not.toBeNull();
    expect(header.querySelector('[data-testid="username"]')).not.toBeNull();
    expect(
      header.querySelector('[data-testid="formatted-distance-date"]'),
    ).not.toBeNull();
    expect(screen.getByTestId(`${TEST_ID_PREFIX}-body`)).toHaveTextContent(
      'the comment body',
    );
  });

  it('falls back to plain text while renderer options are still loading', () => {
    renderEntry({ rendererOptions: undefined, commentText: 'plain body' });

    expect(screen.getByTestId(`${TEST_ID_PREFIX}-body`)).toHaveTextContent(
      'plain body',
    );
  });

  it('does not build the shared CommentCard box around itself', () => {
    const { container } = renderEntry();

    expect(container.querySelector('.page-comment')).toBeNull();
    expect(container.querySelector('.page-comment-main')).toBeNull();
    expect(container.querySelector('.bg-comment')).toBeNull();
    expect(container.querySelector('.page-comment-body')).toBeNull();
  });

  it('renders beforeBody between the header and the body, and headerExtra inside the header row', () => {
    renderEntry({
      beforeBody: <div data-testid="before-body-slot" />,
      headerExtra: <button type="button" data-testid="header-extra-slot" />,
    });

    const header = screen.getByTestId(`${TEST_ID_PREFIX}-header`);
    expect(header).toContainElement(screen.getByTestId('header-extra-slot'));

    const beforeBody = screen.getByTestId('before-body-slot');
    const body = screen.getByTestId(`${TEST_ID_PREFIX}-body`);
    expect(
      header.compareDocumentPosition(beforeBody) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      beforeBody.compareDocumentPosition(body) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('omits both slots when the caller passes neither (a reply)', () => {
    renderEntry();

    expect(screen.queryByTestId('before-body-slot')).not.toBeInTheDocument();
    expect(screen.queryByTestId('header-extra-slot')).not.toBeInTheDocument();
  });

  it('hides the edit and delete affordances when the viewer is not the author (Req 1.6)', () => {
    renderEntry({ isOwn: false });

    expect(
      screen.queryByTestId(`${TEST_ID_PREFIX}-edit-button`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`${TEST_ID_PREFIX}-delete-button`),
    ).not.toBeInTheDocument();
  });

  it('keeps headerExtra reachable for a viewer who is not the author', () => {
    renderEntry({
      isOwn: false,
      headerExtra: <button type="button" data-testid="header-extra-slot" />,
    });

    expect(screen.getByTestId('header-extra-slot')).toBeInTheDocument();
  });

  it('disables the edit and delete controls under the read-only-user restriction (Req 1.6)', () => {
    isDisabledRef.current = true;
    renderEntry();

    expect(
      screen.getByTestId('not-available-for-read-only-user'),
    ).toBeInTheDocument();
    expect(screen.getByTestId(`${TEST_ID_PREFIX}-edit-button`)).toBeDisabled();
    expect(
      screen.getByTestId(`${TEST_ID_PREFIX}-delete-button`),
    ).toBeDisabled();
  });

  it('gives its icon buttons a square, non-circular shape', () => {
    renderEntry();

    for (const testId of [
      `${TEST_ID_PREFIX}-edit-button`,
      `${TEST_ID_PREFIX}-delete-button`,
    ]) {
      expect(screen.getByTestId(testId)).not.toHaveClass('rounded-circle');
    }
  });

  it('replaces only the body with the editor when editing, seeded with the current text (Req 2.2)', async () => {
    renderEntry({
      commentText: 'the comment body',
      beforeBody: <div data-testid="before-body-slot" />,
      headerExtra: <button type="button" data-testid="header-extra-slot" />,
    });

    await userEvent.click(screen.getByTestId(`${TEST_ID_PREFIX}-edit-button`));

    expect(
      screen.getByTestId('mention-aware-comment-input-mock'),
    ).toBeInTheDocument();
    expect(mentionAwareCommentInputProps.current?.initialValue).toBe(
      'the comment body',
    );
    // The editor key has to be unique per entry instance, otherwise two
    // entries on screen share one CodeMirror instance.
    expect(mentionAwareCommentInputProps.current?.editorKey).toBe(
      'entry_edit_comment1',
    );
    // The header row and the quote stay on screen; only the body is replaced.
    expect(screen.getByTestId(`${TEST_ID_PREFIX}-header`)).toBeInTheDocument();
    expect(screen.getByTestId('header-extra-slot')).toBeInTheDocument();
    expect(screen.getByTestId('before-body-slot')).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${TEST_ID_PREFIX}-body`),
    ).not.toBeInTheDocument();
  });

  it('persists the edited text through onUpdate and leaves edit mode (Req 2.2)', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderEntry({ onUpdate });

    await userEvent.click(screen.getByTestId(`${TEST_ID_PREFIX}-edit-button`));
    await act(async () => {
      await (
        mentionAwareCommentInputProps.current?.onSubmit as (
          text: string,
        ) => Promise<unknown>
      )('the edited body');
    });

    expect(onUpdate).toHaveBeenCalledWith('the edited body');
    await waitFor(() => {
      expect(
        screen.queryByTestId('mention-aware-comment-input-mock'),
      ).not.toBeInTheDocument();
    });
  });

  it('stays in edit mode and shows an error when onUpdate rejects', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('permission denied'));
    renderEntry({ onUpdate });

    await userEvent.click(screen.getByTestId(`${TEST_ID_PREFIX}-edit-button`));
    await act(async () => {
      await expect(
        (
          mentionAwareCommentInputProps.current?.onSubmit as (
            text: string,
          ) => Promise<unknown>
        )('the edited body'),
        // Rethrown so the input keeps the typed text instead of clearing it.
      ).rejects.toThrow('permission denied');
    });

    expect(
      screen.getByTestId(`${TEST_ID_PREFIX}-edit-error`),
    ).toHaveTextContent('permission denied');
    expect(
      screen.getByTestId('mention-aware-comment-input-mock'),
    ).toBeInTheDocument();
  });

  it('leaves edit mode without saving on Cancel', async () => {
    const onUpdate = vi.fn();
    renderEntry({ onUpdate });

    await userEvent.click(screen.getByTestId(`${TEST_ID_PREFIX}-edit-button`));
    await userEvent.click(
      screen.getByTestId(`${TEST_ID_PREFIX}-edit-cancel-button`),
    );

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByTestId(`${TEST_ID_PREFIX}-body`)).toBeInTheDocument();
  });

  it("drives Save and the mention picker through the input's reported controls (Req 2.2)", async () => {
    renderEntry();

    await userEvent.click(screen.getByTestId(`${TEST_ID_PREFIX}-edit-button`));
    await userEvent.click(
      screen.getByTestId(`${TEST_ID_PREFIX}-edit-save-button`),
    );
    expect(commentInputControls.submit).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTestId('mention-picker-button-mock'));
    expect(commentInputControls.insertMention).toHaveBeenCalledWith('alice');
  });

  it('disables Save while the input reports it cannot submit', async () => {
    commentInputControls.canSubmit = false;
    renderEntry();

    await userEvent.click(screen.getByTestId(`${TEST_ID_PREFIX}-edit-button`));

    expect(
      screen.getByTestId(`${TEST_ID_PREFIX}-edit-save-button`),
    ).toBeDisabled();
  });

  it('asks for confirmation before deleting, and only then calls onRemove (Req 2.6)', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    renderEntry({ onRemove });

    await userEvent.click(
      screen.getByTestId(`${TEST_ID_PREFIX}-delete-button`),
    );

    expect(
      screen.getByTestId(`${TEST_ID_PREFIX}-delete-confirm`),
    ).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByTestId(`${TEST_ID_PREFIX}-delete-confirm-button`),
    );

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('does not delete when the confirmation is cancelled (Req 2.6)', async () => {
    const onRemove = vi.fn();
    renderEntry({ onRemove });

    await userEvent.click(
      screen.getByTestId(`${TEST_ID_PREFIX}-delete-button`),
    );
    await userEvent.click(
      screen.getByTestId(`${TEST_ID_PREFIX}-delete-cancel-button`),
    );

    expect(onRemove).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId(`${TEST_ID_PREFIX}-delete-confirm`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`${TEST_ID_PREFIX}-delete-button`),
    ).toBeInTheDocument();
  });

  it('shows an error and closes the confirmation when onRemove rejects (Req 2.6)', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error('already gone'));
    renderEntry({ onRemove });

    await userEvent.click(
      screen.getByTestId(`${TEST_ID_PREFIX}-delete-button`),
    );
    await userEvent.click(
      screen.getByTestId(`${TEST_ID_PREFIX}-delete-confirm-button`),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(`${TEST_ID_PREFIX}-delete-error`),
      ).toHaveTextContent('already gone');
    });
    expect(
      screen.queryByTestId(`${TEST_ID_PREFIX}-delete-confirm`),
    ).not.toBeInTheDocument();
  });

  it('hides the edit and delete affordances while the delete confirmation is open', async () => {
    renderEntry();

    await userEvent.click(
      screen.getByTestId(`${TEST_ID_PREFIX}-delete-button`),
    );

    expect(
      screen.queryByTestId(`${TEST_ID_PREFIX}-edit-button`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`${TEST_ID_PREFIX}-delete-button`),
    ).not.toBeInTheDocument();
  });
});
