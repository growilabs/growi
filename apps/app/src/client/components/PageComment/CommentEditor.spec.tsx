/**
 * Regression guard for the page-bottom comment editor.
 *
 * The inline-comment work exposed `hideToolbar` on `CodeMirrorEditorProps` and
 * passes it (plus a `basicSetup` override that removes the line-number and fold
 * gutters) from `InlineCommentForm`. This file pins the fact that the *normal*
 * comment editor did not opt into either: it must keep its toolbar and its
 * default gutters, so the type change stays invisible here.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommentEditor } from './CommentEditor';

const editorProps = vi.hoisted(
  () => ({ current: undefined }) as { current?: Record<string, unknown> },
);

const editorState = vi.hoisted(() => ({ docText: '' }));

vi.mock('@growi/editor', () => ({
  GlobalCodeMirrorEditorKey: { COMMENT_NEW: 'comment_new' },
  useSetResolvedTheme: () => vi.fn(),
}));

vi.mock('@growi/editor/dist/client/components/CodeMirrorEditorComment', () => ({
  CodeMirrorEditorComment: (props: Record<string, unknown>) => {
    editorProps.current = props;
    return <div data-testid="comment-editor-codemirror" />;
  },
}));

vi.mock('@growi/editor/dist/client/services', () => ({
  createMentionCompletionExtension: vi.fn(() => ({})),
  mentionDecorationSettings: {},
}));

const codeMirrorEditorMock = vi.hoisted(() => ({
  getDocString: vi.fn(() => editorState.docText),
  initDoc: vi.fn(),
  appendExtensions: vi.fn(() => vi.fn()),
  focus: vi.fn(),
}));

vi.mock('@growi/editor/dist/client/stores/codemirror-editor', () => ({
  useCodeMirrorEditorIsolated: () => ({ data: codeMirrorEditorMock }),
}));

vi.mock('@growi/ui/dist/components', () => ({
  UserPicture: () => <span data-testid="user-picture" />,
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('~/client/services/upload-attachments', () => ({
  uploadAttachments: vi.fn(),
}));
vi.mock('~/client/util/apiv3-client', () => ({ apiv3Get: vi.fn() }));
vi.mock('~/client/util/toastr', () => ({ toastError: vi.fn() }));

vi.mock('~/states/global', () => ({ useCurrentUser: () => undefined }));
vi.mock('~/states/page', () => ({ useCurrentPagePath: () => '/foo' }));
vi.mock('~/states/server-configurations', () => ({
  isSlackConfiguredAtom: { debugLabel: 'isSlackConfigured' },
  useAcceptedUploadFileType: () => undefined,
}));
vi.mock('~/states/ui/editor', () => ({
  useIsSlackEnabled: () => [false, vi.fn()],
}));
vi.mock('~/states/ui/unsaved-warning', () => ({
  useCommentEditorsDirtyMap: () => ({ markDirty: vi.fn(), markClean: vi.fn() }),
}));
const swrxPageCommentMock = vi.hoisted(() => ({
  update: vi.fn(),
  post: vi.fn(),
}));
vi.mock('~/stores/comment', () => ({
  useSWRxPageComment: () => swrxPageCommentMock,
}));
vi.mock('~/stores/editor', () => ({
  useEditorSettings: () => ({ data: undefined }),
  useSWRxSlackChannels: () => ({ data: undefined }),
}));
vi.mock('~/stores-universal/use-next-themes', () => ({
  useNextThemes: () => ({ resolvedTheme: 'light' }),
}));

vi.mock('jotai', () => ({ useAtomValue: () => false }));

vi.mock('../NotAvailableForGuest', () => ({
  NotAvailableForGuest: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('../NotAvailableForReadOnlyUser', () => ({
  NotAvailableIfReadOnlyUserNotAllowedToComment: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <>{children}</>,
}));
vi.mock('./CommentPreview', () => ({
  CommentPreview: () => <div data-testid="comment-preview" />,
}));

describe('CommentEditor', () => {
  beforeEach(() => {
    editorProps.current = undefined;
    editorState.docText = '';
    swrxPageCommentMock.update.mockClear();
    swrxPageCommentMock.post.mockClear();
  });

  const renderEditor = (props: Partial<Record<string, unknown>> = {}) =>
    render(<CommentEditor pageId="page-1" revisionId="rev-1" {...props} />);

  it('renders the CodeMirror comment editor', () => {
    renderEditor();

    expect(screen.getByTestId('comment-editor-codemirror')).toBeInTheDocument();
  });

  it('keeps the editor toolbar and the default gutters — it opts into neither hideToolbar nor a basicSetup override', () => {
    renderEditor();

    expect(editorProps.current?.hideToolbar).toBeUndefined();
    expect(editorProps.current?.cmProps).not.toHaveProperty('basicSetup');
  });

  describe('onSubmit override', () => {
    it('calls the supplied onSubmit with the typed text instead of the default post/update path, and does not call useSWRxPageComment.post', async () => {
      editorState.docText = 'a reply body';
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const onCommented = vi.fn();
      renderEditor({ onSubmit, onCommented });

      fireEvent.click(screen.getAllByTestId('comment-submit-button')[0]);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith('a reply body');
      });
      expect(swrxPageCommentMock.post).not.toHaveBeenCalled();
      expect(swrxPageCommentMock.update).not.toHaveBeenCalled();
      expect(onCommented).toHaveBeenCalled();
    });

    it('falls back to the default post path when onSubmit is not provided (unchanged behavior)', async () => {
      editorState.docText = 'a normal comment';
      swrxPageCommentMock.post.mockResolvedValue(undefined);
      const onCommented = vi.fn();
      renderEditor({ onCommented });

      fireEvent.click(screen.getAllByTestId('comment-submit-button')[0]);

      await waitFor(() => {
        expect(swrxPageCommentMock.post).toHaveBeenCalled();
      });
      expect(onCommented).toHaveBeenCalled();
    });

    it('shows an error and does not close the editor when onSubmit rejects', async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error('failed to post'));
      const onCommented = vi.fn();
      renderEditor({ onSubmit, onCommented });

      fireEvent.click(screen.getAllByTestId('comment-submit-button')[0]);

      await waitFor(() => {
        expect(screen.getAllByText('failed to post').length).toBeGreaterThan(0);
      });
      expect(onCommented).not.toHaveBeenCalled();
    });
  });
});
