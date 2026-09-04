import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InlineCommentForm } from './InlineCommentForm';

// --- @growi/editor mocks -------------------------------------------------
// InlineCommentForm follows CommentEditor.tsx's mention-aware textarea
// pattern (CodeMirrorEditorComment + useCodeMirrorEditorIsolated + mention
// extensions). These are the boundary this test mocks: the observable
// contract under test is "typing into the comment input and submitting
// calls the inline-comment store correctly", not CodeMirror's internals.

const editorState = vi.hoisted(() => ({ docText: '' }));

const codeMirrorEditorMock = vi.hoisted(() => ({
  getDocString: vi.fn(() => editorState.docText),
  initDoc: vi.fn(),
  appendExtensions: vi.fn(() => vi.fn()),
  insertText: vi.fn(),
}));

vi.mock('@growi/editor', () => ({
  useSetResolvedTheme: () => vi.fn(),
}));

vi.mock('@growi/editor/dist/client/components/CodeMirrorEditorComment', () => ({
  CodeMirrorEditorComment: (props: {
    cmProps?: { onChange?: (value: string) => void };
  }) => (
    // eslint-disable-next-line jsx-a11y/no-onchange
    <textarea
      data-testid="inline-comment-textarea"
      onChange={(e) => {
        editorState.docText = e.target.value;
        props.cmProps?.onChange?.(e.target.value);
      }}
    />
  ),
}));

const createMentionCompletionExtension = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('@growi/editor/dist/client/services', () => ({
  createMentionCompletionExtension,
  mentionDecorationSettings: {},
}));

vi.mock('@growi/editor/dist/client/stores/codemirror-editor', () => ({
  useCodeMirrorEditorIsolated: () => ({ data: codeMirrorEditorMock }),
}));

vi.mock('~/stores-universal/use-next-themes', () => ({
  useNextThemes: () => ({ resolvedTheme: 'light' }),
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: vi.fn(),
}));

const create = vi.hoisted(() => vi.fn());
vi.mock('../../stores/inline-comment', () => ({
  useSWRxInlineComments: () => ({ create }),
}));

// fetchMentionUsers is the shared service extracted in task 1.4. This test
// asserts InlineCommentForm's mention-completion extension is wired to it
// (rather than a local reimplementation) by checking the reference identity
// below, and never actually invokes the mocked function's network path.
const fetchMentionUsersMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/fetch-mention-users', () => ({
  fetchMentionUsers: fetchMentionUsersMock,
}));

// MentionPickerButton (task 3.1) is mocked at the module boundary: this test
// proves the InlineCommentForm -> onInsert -> codeMirrorEditor.insertText
// wiring, not MentionPickerButton's own dropdown/fetch behavior (already
// covered by MentionPickerButton.spec.tsx).
vi.mock('./MentionPickerButton', () => ({
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

const validAnchor = {
  quote: 'selected text',
  prefix: 'pre',
  suffix: 'suf',
  approxOffset: 3,
};

describe('InlineCommentForm', () => {
  beforeEach(() => {
    editorState.docText = '';
    create.mockReset();
    create.mockResolvedValue({});
  });

  it('disables submit when the anchor has no quote, even with comment text entered (Requirement 1.7)', () => {
    render(
      <InlineCommentForm
        pageId="page-1"
        anchorOriginRevisionId="rev-1"
        anchor={{ ...validAnchor, quote: '' }}
      />,
    );

    fireEvent.change(screen.getByTestId('inline-comment-textarea'), {
      target: { value: 'a comment' },
    });

    expect(screen.getByTestId('inline-comment-submit-button')).toBeDisabled();
  });

  it('disables submit when the comment body is empty', () => {
    render(
      <InlineCommentForm
        pageId="page-1"
        anchorOriginRevisionId="rev-1"
        anchor={validAnchor}
      />,
    );

    expect(screen.getByTestId('inline-comment-submit-button')).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });

  it('calls the store create() with pageId, anchorOriginRevisionId, comment, and anchor on submit', async () => {
    const onSubmitted = vi.fn();
    render(
      <InlineCommentForm
        pageId="page-1"
        anchorOriginRevisionId="rev-1"
        anchor={validAnchor}
        onSubmitted={onSubmitted}
      />,
    );

    fireEvent.change(screen.getByTestId('inline-comment-textarea'), {
      target: { value: 'my comment' },
    });
    expect(
      screen.getByTestId('inline-comment-submit-button'),
    ).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('inline-comment-submit-button'));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        pageId: 'page-1',
        anchorOriginRevisionId: 'rev-1',
        comment: 'my comment',
        anchor: validAnchor,
      });
    });
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
  });

  it('renders MentionPickerButton and inserts "@<username> " at the cursor on selection (Requirement 3.3)', () => {
    render(
      <InlineCommentForm
        pageId="page-1"
        anchorOriginRevisionId="rev-1"
        anchor={validAnchor}
      />,
    );

    const pickerButton = screen.getByTestId('mention-picker-button-mock');
    fireEvent.click(pickerButton);

    expect(codeMirrorEditorMock.insertText).toHaveBeenCalledWith('@alice ');
  });

  it('wires the mention-completion extension to the shared fetchMentionUsers service, not a local reimplementation (Requirement 3.4)', () => {
    render(
      <InlineCommentForm
        pageId="page-1"
        anchorOriginRevisionId="rev-1"
        anchor={validAnchor}
      />,
    );

    expect(createMentionCompletionExtension).toHaveBeenCalledWith(
      fetchMentionUsersMock,
    );
  });
});
