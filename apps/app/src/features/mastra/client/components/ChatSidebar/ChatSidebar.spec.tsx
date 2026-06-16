// @vitest-environment happy-dom

import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ChatStatus } from 'ai';
import { mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';

import type { ChatSidebarStatus } from '../../status/chat-sidebar';
import { ChatSidebar } from './ChatSidebar';

// --- sendMessage spy (the send-flow boundary we assert against) ------------
const sendMessage = vi.fn();

// Controllable chat status so a test can put the assistant in a busy state.
const { chatState } = vi.hoisted(() => {
  const chatState: { status: ChatStatus | undefined } = { status: undefined };
  return { chatState };
});

// @ai-sdk/react useChat: a controllable object exposing the sendMessage spy.
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    status: chatState.status,
    regenerate: vi.fn(),
    setMessages: vi.fn(),
  }),
}));

// Chat sidebar status: provide an opened sidebar so ChatSidebar renders its
// header + input without reaching into jotai.
vi.mock('../../status/chat-sidebar', () => ({
  useChatSidebarStatus: (): ChatSidebarStatus => ({
    isOpened: true,
    openSeq: 0,
  }),
  useChatSidebarActions: () => ({ close: vi.fn() }),
}));

// Mastra SWR stores ChatSidebar imports.
vi.mock('../../stores/message', () => ({
  useSWRxMessages: () => ({ data: undefined }),
}));
vi.mock('../../stores/thread', () => ({
  useSWRINFxRecentThreads: () => ({ mutate: vi.fn() }),
}));

// Search store: PageMentionInput's controller calls useSWRxSearch. Stub it with
// a controllable return so a test can make candidates appear.
const { searchState } = vi.hoisted(() => ({
  searchState: {
    current: {
      data: undefined as IFormattedSearchResult | undefined,
      isLoading: false,
    },
  },
}));
vi.mock('~/stores/search', () => ({
  useSWRxSearch: () => searchState.current,
}));

/** Build a minimal, type-safe search result with the given page paths. */
const setSearchResult = (
  pages: ReadonlyArray<{ id: string; path: string }>,
): void => {
  searchState.current = {
    data: mock<IFormattedSearchResult>({
      data: pages.map((p) =>
        mock<IPageWithSearchMeta>({
          data: mock<IPageWithSearchMeta['data']>({ _id: p.id, path: p.path }),
        }),
      ),
    }),
    isLoading: false,
  };
};

// i18n: return the key itself so the placeholder assertion is deterministic.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// PageMentionInput's controller debounces the mention query via usehooks-ts
// useDebounceValue (lodash.debounce, 200ms). The debounce *timing* is covered in
// use-mention-controller.spec; here it is irrelevant (search results are mocked),
// so make it synchronous (identity). This also prevents a trailing-edge timer
// from firing after happy-dom is torn down in the full parallel suite
// (ReferenceError: window is not defined).
vi.mock('usehooks-ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('usehooks-ts')>();
  return {
    ...actual,
    useDebounceValue: (value: unknown) => [value, vi.fn()],
  };
});

// next/router: PageMentionInput uses useRouter for chip-click SPA navigation.
vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/** Locate the live EditorView mounted inside PageMentionInput. */
const getView = (container: HTMLElement): EditorView => {
  const dom = container.querySelector<HTMLElement>('.cm-editor');
  if (dom == null) {
    throw new Error('EditorView DOM (.cm-editor) not found');
  }
  const view = EditorView.findFromDOM(dom);
  if (view == null) {
    throw new Error('EditorView instance not found from DOM');
  }
  return view;
};

const hiddenMessageInput = (container: HTMLElement): HTMLInputElement | null =>
  container.querySelector('input[name="message"]');

/**
 * Submit the PromptInput form and flush the microtask queue. PromptInput's
 * handleSubmit reads formData synchronously but invokes `onSubmit`
 * (→ sendMessage) inside a `Promise.all(...).then(...)`, so the call lands a
 * microtask later.
 */
const submitForm = async (container: HTMLElement): Promise<void> => {
  const form = container.querySelector('form');
  if (form == null) {
    throw new Error('PromptInput form not found');
  }
  await act(async () => {
    form.requestSubmit();
    await Promise.resolve();
  });
};

/**
 * Dispatch the form's submit event directly. Exercises PromptInput's onSubmit
 * (→ ChatSidebar.handleSubmit → sendMessage) without going through
 * `form.requestSubmit()`, which is unreliable under happy-dom.
 */
const submitViaEvent = async (container: HTMLElement): Promise<void> => {
  const form = container.querySelector('form');
  if (form == null) {
    throw new Error('PromptInput form not found');
  }
  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
  });
};

beforeEach(() => {
  sendMessage.mockClear();
  searchState.current = { data: undefined, isLoading: false };
  chatState.status = undefined;

  // happy-dom 15.7.4's HTMLFormElement.reset() throws ("hasAttribute" on an
  // undefined ref) when a CodeMirror editor is mounted inside the form.
  // PromptInput calls form.reset() inside its submit handler, so stub it to a
  // no-op to let the submit path execute. The editor doc (not the form) is the
  // source of truth and clearing happens via the value→doc reset, so the stub
  // does not affect what these tests assert.
  vi.spyOn(HTMLFormElement.prototype, 'reset').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatSidebar — PageMentionInput integration (6.1)', () => {
  it('mounts PageMentionInput as the input leaf', () => {
    const { container } = render(<ChatSidebar />);

    // PageMentionInput-specific marker — proves the CodeMirror leaf replaced
    // the plain textarea (the textarea carries no such data-slot).
    expect(
      container.querySelector('[data-slot="page-mention-input"]'),
    ).not.toBeNull();
  });

  it('submits the flattened path string (incl. a mention) to sendMessage', async () => {
    const { container } = render(<ChatSidebar />);

    // Drive the live editor: insert a page path (mirrors how a committed
    // mention holds its path string in the doc).
    const view = getView(container);
    act(() => {
      view.dispatch({ changes: { from: 0, insert: '/docs/foo' } });
    });

    // The hidden form field mirrors the flattened doc text.
    expect(hiddenMessageInput(container)?.value).toBe('/docs/foo');

    await submitForm(container);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('/docs/foo') }),
      expect.anything(),
    );
  });

  it('runs the full @ → select candidate → commit → submit flow', async () => {
    setSearchResult([{ id: 'p1', path: '/docs/foo' }]);
    const { container } = render(<ChatSidebar />);

    // Type "@foo" to open a mention session (word boundary at line start).
    const view = getView(container);
    act(() => {
      view.dispatch({
        changes: { from: 0, insert: '@foo' },
        selection: { anchor: 4 },
      });
    });

    // The candidate list opens with the search result; select it.
    const row = (await screen.findByText('/docs/foo')).closest(
      '[role="option"]',
    );
    if (row == null) {
      throw new Error('mention candidate [role="option"] not found');
    }
    fireEvent.click(row);

    // Commit replaced "@foo" with the path (plus a trailing space), surfaced
    // through the hidden input and into the submitted message text.
    expect(hiddenMessageInput(container)?.value).toContain('/docs/foo');

    await submitForm(container);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('/docs/foo') }),
      expect.anything(),
    );
  });

  it('still sends plain text with no mention (no regression)', async () => {
    const { container } = render(<ChatSidebar />);

    const view = getView(container);
    act(() => {
      view.dispatch({ changes: { from: 0, insert: 'hello world' } });
    });

    await submitForm(container);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hello world' }),
      expect.anything(),
    );
  });
});

describe('ChatSidebar — send suppression while busy (#5)', () => {
  it.each([
    'submitted',
    'streaming',
  ] as const)('does not start a new request while status is "%s", and keeps the composed text', async (status) => {
    chatState.status = status;
    const { container } = render(<ChatSidebar />);

    const view = getView(container);
    act(() => {
      view.dispatch({ changes: { from: 0, insert: 'next message' } });
    });

    await submitViaEvent(container);

    // Submission is suppressed while the assistant is responding...
    expect(sendMessage).not.toHaveBeenCalled();
    // ...and the editable input keeps what the user has composed.
    expect(view.state.doc.toString()).toBe('next message');
  });

  it('sends normally once the assistant is idle (status undefined)', async () => {
    chatState.status = undefined;
    const { container } = render(<ChatSidebar />);

    const view = getView(container);
    act(() => {
      view.dispatch({ changes: { from: 0, insert: 'go' } });
    });

    await submitViaEvent(container);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'go' }),
      expect.anything(),
    );
  });
});

describe('ChatSidebar — empty input is not submittable', () => {
  it('does not call sendMessage when the input is empty', async () => {
    const { container } = render(<ChatSidebar />);

    // No text composed: submitting must be a no-op (no placeholder fallback).
    await submitViaEvent(container);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not call sendMessage when the input is whitespace-only', async () => {
    const { container } = render(<ChatSidebar />);

    const view = getView(container);
    act(() => {
      view.dispatch({ changes: { from: 0, insert: '   ' } });
    });

    await submitViaEvent(container);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
