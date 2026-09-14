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

// Captures the props InlineCommentForm hands to CodeMirrorEditorComment, so the
// editor-chrome expectations (design.md 決定5) are asserted on the observable
// prop contract rather than on CodeMirror internals.
const editorProps = vi.hoisted(
  () => ({ current: undefined }) as { current?: Record<string, unknown> },
);

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
  }) => {
    editorProps.current = props;
    return (
      // eslint-disable-next-line jsx-a11y/no-onchange
      <textarea
        data-testid="inline-comment-textarea"
        onChange={(e) => {
          editorState.docText = e.target.value;
          props.cmProps?.onChange?.(e.target.value);
        }}
      />
    );
  },
}));

const createMentionCompletionExtension = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('@growi/editor/dist/client/services', () => ({
  createMentionCompletionExtension,
  mentionDecorationSettings: {},
}));

vi.mock('@growi/editor/dist/client/stores/codemirror-editor', () => ({
  useCodeMirrorEditorIsolated: () => ({ data: codeMirrorEditorMock }),
}));

// `t` returns the i18n key verbatim, so the label assertions below prove the
// component picked the right existing key without coupling to translated text
// (which lives in the locale JSON, not here). Same pattern as
// SelectionActionButton.spec.tsx.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('~/stores-universal/use-next-themes', () => ({
  useNextThemes: () => ({ resolvedTheme: 'light' }),
}));

// The composing user's avatar (UserPicture) is the header row's own
// well-tested concern (see CommentCard.spec.tsx / InlineCommentReplies.spec.tsx
// for the same mocking boundary) -- this file only proves InlineCommentForm
// renders one, not UserPicture's own fallback/link/tooltip behavior.
vi.mock('@growi/ui/dist/components', () => ({
  UserPicture: () => <span data-testid="user-picture" />,
}));

vi.mock('~/states/global', () => ({
  useCurrentUser: () => undefined,
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
    editorProps.current = undefined;
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

  describe('theme-aware appearance (Requirement 11.1, 11.2, 11.5, 11.6, 13.3)', () => {
    const renderForm = () =>
      render(
        <InlineCommentForm
          pageId="page-1"
          anchorOriginRevisionId="rev-1"
          anchor={validAnchor}
        />,
      );

    it('renders the submit button as a Bootstrap 5 primary icon button labelled via aria-label', () => {
      renderForm();

      const submitButton = screen.getByTestId('inline-comment-submit-button');
      expect(submitButton).toHaveClass('btn', 'btn-sm', 'btn-primary');
      expect(submitButton).toHaveAttribute(
        'aria-label',
        'page_comment.comment',
      );
    });

    it('does not render a visible Cancel button', () => {
      renderForm();

      expect(
        screen.queryByRole('button', { name: 'Cancel' }),
      ).not.toBeInTheDocument();
    });

    it('keeps the quote in the DOM for screen readers and Playwright, but visually hidden', () => {
      renderForm();

      const quote = screen.getByText(validAnchor.quote);
      expect(quote.tagName).toBe('BLOCKQUOTE');
      expect(quote).toHaveClass(
        'visually-hidden',
        // Kept as a plain (non-hashed) class: the inline-comment Playwright
        // suite locates the quote by `.inline-comment-form-quote`.
        'inline-comment-form-quote',
      );
    });

    it('hides the editor toolbar, line numbers and fold gutter (design.md 決定5)', () => {
      renderForm();

      expect(editorProps.current?.hideToolbar).toBe(true);
      expect(editorProps.current?.cmProps).toMatchObject({
        basicSetup: { lineNumbers: false, foldGutter: false },
      });
    });

    it("renders the composing user's avatar next to the input, matching the reference mockup", () => {
      renderForm();

      expect(screen.getByTestId('user-picture')).toBeInTheDocument();
    });
  });

  describe('cancellation without a visible Cancel button', () => {
    it('calls onCanceled when Escape is pressed', () => {
      const onCanceled = vi.fn();
      render(
        <InlineCommentForm
          pageId="page-1"
          anchorOriginRevisionId="rev-1"
          anchor={validAnchor}
          onCanceled={onCanceled}
        />,
      );

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onCanceled).toHaveBeenCalledTimes(1);
    });

    it('calls onCanceled on a mousedown outside the form', () => {
      const onCanceled = vi.fn();
      render(
        <div>
          <InlineCommentForm
            pageId="page-1"
            anchorOriginRevisionId="rev-1"
            anchor={validAnchor}
            onCanceled={onCanceled}
          />
          <button type="button" data-testid="outside-element">
            outside
          </button>
        </div>,
      );

      fireEvent.mouseDown(screen.getByTestId('outside-element'));

      expect(onCanceled).toHaveBeenCalledTimes(1);
    });

    it('does not call onCanceled on a mousedown inside the form (e.g. placing the caret in the textarea)', () => {
      const onCanceled = vi.fn();
      render(
        <InlineCommentForm
          pageId="page-1"
          anchorOriginRevisionId="rev-1"
          anchor={validAnchor}
          onCanceled={onCanceled}
        />,
      );

      fireEvent.mouseDown(screen.getByTestId('inline-comment-textarea'));

      expect(onCanceled).not.toHaveBeenCalled();
    });

    it('does not call onCanceled on a mousedown inside the mention-completion popup, which is appended to document.body outside the form', () => {
      const onCanceled = vi.fn();
      render(
        <div>
          <InlineCommentForm
            pageId="page-1"
            anchorOriginRevisionId="rev-1"
            anchor={validAnchor}
            onCanceled={onCanceled}
          />
          {/* Simulates @codemirror/autocomplete's popup DOM: rendered as a
              sibling of the form (via tooltips({ parent: document.body }) in
              MentionAwareCommentInput), not nested inside it. */}
          <div className="cm-tooltip-autocomplete">
            <li data-testid="mention-suggestion">@alice</li>
          </div>
        </div>,
      );

      fireEvent.mouseDown(screen.getByTestId('mention-suggestion'));

      expect(onCanceled).not.toHaveBeenCalled();
    });
  });
});
