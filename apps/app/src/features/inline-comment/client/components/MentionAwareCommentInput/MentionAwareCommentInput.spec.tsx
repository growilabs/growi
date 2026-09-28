import type { JSX } from 'react';
import { useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentionPickerButton } from '../InlineCommentForm/MentionPickerButton';
import { MentionAwareCommentInput } from './MentionAwareCommentInput';
import { useCommentInputControls } from './use-comment-input-controls';

// --- @growi/editor mocks -------------------------------------------------
// MentionAwareCommentInput follows CommentEditor.tsx's mention-aware textarea
// pattern (CodeMirrorEditorComment + useCodeMirrorEditorIsolated + mention
// extensions), same as InlineCommentForm.spec.tsx mocked before this
// component was extracted from it. The observable contract under test is
// "typing into the comment input and submitting calls onSubmit correctly",
// not CodeMirror's internals.

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

const tooltipsMock = vi.hoisted(() =>
  vi.fn(() => 'tooltips-extension-sentinel'),
);
// EditorView.theme() itself returns an ARRAY of two extensions, not a single
// one (see MentionAwareCommentInput.tsx's own comment on this) -- the mock
// mirrors that shape so the wrapping test below exercises the real hazard,
// not a simplified stand-in.
const themeMock = vi.hoisted(() =>
  vi.fn(() => ['theme-part-1-sentinel', 'theme-part-2-sentinel']),
);
vi.mock('@codemirror/view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codemirror/view')>();
  return {
    ...actual,
    tooltips: tooltipsMock,
    EditorView: { ...actual.EditorView, theme: themeMock },
  };
});

vi.mock('@growi/editor/dist/client/stores/codemirror-editor', () => ({
  useCodeMirrorEditorIsolated: () => ({ data: codeMirrorEditorMock }),
}));

// `t` returns the i18n key verbatim, matching InlineCommentForm.spec.tsx's
// prior mocking convention.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('~/stores-universal/use-next-themes', () => ({
  useNextThemes: () => ({ resolvedTheme: 'light' }),
}));

// fetchMentionUsers is the shared service extracted in task 1.4 (resolves to
// the same absolute module InlineCommentForm.spec.tsx already mocked).
const fetchMentionUsersMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/fetch-mention-users', () => ({
  fetchMentionUsers: fetchMentionUsersMock,
}));

// MentionPickerButton is mocked at the module boundary: this test proves the
// MentionAwareCommentInput -> onInsert -> codeMirrorEditor.insertText wiring,
// not MentionPickerButton's own dropdown/fetch behavior (already covered by
// MentionPickerButton.spec.tsx). The file itself still lives under
// InlineCommentForm/ (task 5.1's boundary keeps it untouched).
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

/**
 * Stands in for a real caller: it takes the controls through
 * `onControlsChange` (via the shared `useCommentInputControls` hook every
 * caller uses) and renders its own submit / mention-picker buttons, which is
 * the only way those controls exist at all now that the component renders
 * neither itself.
 *
 * `renderCount` is exposed so the "does not re-render endlessly" test below
 * can assert the controls handshake settles: a caller that stores the whole
 * controls object in state while passing a fresh `onSubmit` closure every
 * render is exactly how this contract could loop.
 */
const CallerHarness = (props: {
  onSubmit: (text: string) => Promise<unknown>;
  onSubmitted?: () => void;
  disabled?: boolean;
  initialValue?: string;
  onRender?: (count: number) => void;
}): JSX.Element => {
  const { onSubmit, onSubmitted, disabled, initialValue, onRender } = props;
  const { canSubmit, submit, insertMention, onControlsChange } =
    useCommentInputControls();

  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  onRender?.(renderCountRef.current);

  return (
    <div className="d-flex align-items-start gap-2">
      <MentionAwareCommentInput
        editorKey="key-1"
        initialValue={initialValue}
        disabled={disabled}
        // Deliberately a fresh closure on every render, matching how the real
        // callers pass `onSubmit`.
        onSubmit={(text) => onSubmit(text)}
        onSubmitted={onSubmitted}
        onControlsChange={onControlsChange}
      />
      <MentionPickerButton onInsert={insertMention} />
      <button
        type="button"
        data-testid="caller-submit-button"
        disabled={!canSubmit}
        onClick={submit}
      >
        send
      </button>
    </div>
  );
};

describe('MentionAwareCommentInput', () => {
  beforeEach(() => {
    editorState.docText = '';
  });

  it("renders neither a submit button nor a mention-picker button of its own — both are the caller's to place", () => {
    render(
      <MentionAwareCommentInput
        editorKey="key-1"
        onSubmit={vi.fn()}
        onControlsChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId('inline-comment-submit-button'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('mention-picker-button-mock'),
    ).not.toBeInTheDocument();
  });

  it('reports controls with canSubmit false while the comment text is empty', () => {
    const onControlsChange = vi.fn();
    render(
      <MentionAwareCommentInput
        editorKey="key-1"
        onSubmit={vi.fn()}
        onControlsChange={onControlsChange}
      />,
    );

    expect(onControlsChange).toHaveBeenCalled();
    const controls = onControlsChange.mock.lastCall?.[0];
    expect(controls.canSubmit).toBe(false);
    expect(typeof controls.submit).toBe('function');
    expect(typeof controls.insertMention).toBe('function');
  });

  it('reports canSubmit false for whitespace-only comment text', () => {
    render(<CallerHarness onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByTestId('inline-comment-textarea'), {
      target: { value: '   ' },
    });

    expect(screen.getByTestId('caller-submit-button')).toBeDisabled();
  });

  it('reports canSubmit true once non-whitespace text is entered', () => {
    render(<CallerHarness onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByTestId('inline-comment-textarea'), {
      target: { value: 'hello' },
    });

    expect(screen.getByTestId('caller-submit-button')).not.toBeDisabled();
  });

  it('keeps canSubmit false when the disabled prop is true, regardless of text', () => {
    render(<CallerHarness onSubmit={vi.fn()} disabled />);

    fireEvent.change(screen.getByTestId('inline-comment-textarea'), {
      target: { value: 'hello' },
    });

    expect(screen.getByTestId('caller-submit-button')).toBeDisabled();
  });

  it('calls onSubmit with the current comment text when the caller invokes submit()', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CallerHarness onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('inline-comment-textarea'), {
      target: { value: 'my comment' },
    });
    fireEvent.click(screen.getByTestId('caller-submit-button'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('my comment');
    });
  });

  it('clears the text and calls onSubmitted on successful submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onSubmitted = vi.fn();
    render(<CallerHarness onSubmit={onSubmit} onSubmitted={onSubmitted} />);

    fireEvent.change(screen.getByTestId('inline-comment-textarea'), {
      target: { value: 'my comment' },
    });
    fireEvent.click(screen.getByTestId('caller-submit-button'));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    expect(codeMirrorEditorMock.initDoc).toHaveBeenCalledWith('');
    // The caller's button reflects the internal text having been cleared,
    // which is only possible if the new canSubmit was reported outward.
    await waitFor(() =>
      expect(screen.getByTestId('caller-submit-button')).toBeDisabled(),
    );
  });

  it('shows an error and preserves the text when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('failed to post'));
    const onSubmitted = vi.fn();
    render(<CallerHarness onSubmit={onSubmit} onSubmitted={onSubmitted} />);

    fireEvent.change(screen.getByTestId('inline-comment-textarea'), {
      target: { value: 'my comment' },
    });
    fireEvent.click(screen.getByTestId('caller-submit-button'));

    await waitFor(() => {
      expect(screen.getByText('failed to post')).toBeInTheDocument();
    });
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(codeMirrorEditorMock.initDoc).not.toHaveBeenCalled();
    expect(screen.getByTestId('caller-submit-button')).not.toBeDisabled();
  });

  it('settles the controls handshake instead of re-rendering the caller endlessly', () => {
    const renderCounts: number[] = [];
    render(
      <CallerHarness
        onSubmit={vi.fn()}
        onRender={(count) => renderCounts.push(count)}
      />,
    );

    // A loop here would blow the stack rather than return, so any finite
    // count already proves termination; the bound keeps it honest.
    expect(renderCounts.at(-1)).toBeLessThan(5);

    fireEvent.change(screen.getByTestId('inline-comment-textarea'), {
      target: { value: 'hello' },
    });

    expect(renderCounts.at(-1)).toBeLessThan(10);
  });

  it("does not render a Cancel button (cancellation is the caller's responsibility)", () => {
    render(
      <MentionAwareCommentInput
        editorKey="key-1"
        onSubmit={vi.fn()}
        onControlsChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
  });

  it('applies initialValue to the editor exactly once at mount, when provided (edit mode)', () => {
    render(
      <MentionAwareCommentInput
        editorKey="key-1"
        onSubmit={vi.fn()}
        initialValue="existing comment body"
      />,
    );

    expect(codeMirrorEditorMock.initDoc).toHaveBeenCalledWith(
      'existing comment body',
    );
    expect(codeMirrorEditorMock.initDoc).toHaveBeenCalledTimes(1);
  });

  it('does not touch the editor doc when initialValue is omitted (create-mode regression check)', () => {
    render(<MentionAwareCommentInput editorKey="key-1" onSubmit={vi.fn()} />);

    expect(codeMirrorEditorMock.initDoc).not.toHaveBeenCalled();
  });

  it('inserts "@<username> " at the cursor when the caller invokes insertMention()', () => {
    render(<CallerHarness onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByTestId('mention-picker-button-mock'));

    expect(codeMirrorEditorMock.insertText).toHaveBeenCalledWith('@alice ');
  });

  it('wires the mention-completion extension to the shared fetchMentionUsers service', () => {
    render(<MentionAwareCommentInput editorKey="key-1" onSubmit={vi.fn()} />);

    expect(createMentionCompletionExtension).toHaveBeenCalledWith(
      fetchMentionUsersMock,
    );
  });

  it("appends a tooltips(parent: document.body) extension, so the mention-completion popup floats above the form instead of being clipped by .cm-editor's own overflow:hidden", () => {
    render(<MentionAwareCommentInput editorKey="key-1" onSubmit={vi.fn()} />);

    expect(tooltipsMock).toHaveBeenCalledWith({ parent: document.body });
    expect(codeMirrorEditorMock.appendExtensions).toHaveBeenCalledWith(
      'tooltips-extension-sentinel',
    );
  });

  it("raises the mention-completion popup above InlineCommentForm's own z-index, wrapped so the two-part theme extension does not get split across appendExtensions calls", () => {
    render(<MentionAwareCommentInput editorKey="key-1" onSubmit={vi.fn()} />);

    expect(themeMock).toHaveBeenCalledWith({
      '.cm-tooltip.cm-tooltip-autocomplete': { zIndex: '1080' },
    });
    // EditorView.theme() returns an array of two extensions (mocked above to
    // mirror that). appendExtensions must receive it wrapped in ANOTHER
    // array -- passed bare, appendExtensions would unpack its two elements
    // and give each its own slot in one shared Compartment, which throws
    // "Duplicate use of compartment in extensions" (reproduced empirically
    // against the real dev server before this wrapping was added).
    expect(codeMirrorEditorMock.appendExtensions).toHaveBeenCalledWith([
      ['theme-part-1-sentinel', 'theme-part-2-sentinel'],
    ]);
  });
});
