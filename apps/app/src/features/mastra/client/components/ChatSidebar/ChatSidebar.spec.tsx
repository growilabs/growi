// @vitest-environment happy-dom

import type { ReactNode } from 'react';
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

// Controllable chat status / error so a test can put the assistant in a busy
// state or simulate a server error. regenerate/clearError are shared spies so
// the error-recovery wiring can be asserted.
const { chatState, regenerate, clearError } = vi.hoisted(() => {
  const chatState: {
    status: ChatStatus | undefined;
    error: Error | undefined;
  } = { status: undefined, error: undefined };
  return { chatState, regenerate: vi.fn(), clearError: vi.fn() };
});

// @ai-sdk/react useChat: a controllable object exposing the sendMessage spy.
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    status: chatState.status,
    regenerate,
    setMessages: vi.fn(),
    error: chatState.error,
    clearError,
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

// Chat model list / selection: controllable so a test can vary the allowed
// models, the server-validated initial selection, and the loading state.
const { modelsState } = vi.hoisted(() => ({
  modelsState: {
    current: {
      data: undefined as
        | {
            models: { id: string; name: string }[];
            defaultModelId?: string;
            selectedModelId?: string;
          }
        | undefined,
    },
  },
}));
vi.mock('../../stores/models', () => ({
  useSWRxChatModels: () => modelsState.current,
}));

// Persisted selection write boundary. The contract is "a model change calls
// scheduleToPut({ aiChatSelectedModel })"; the debounce + HTTP PUT live in the
// shared service (reused unchanged), so the spy is the right boundary (3.6).
const scheduleToPut = vi.fn();
vi.mock('~/client/services/user-ui-settings', () => ({
  scheduleToPut: (...args: unknown[]) => scheduleToPut(...args),
}));

// Spy on the transport factory while keeping the pure label/error helpers real.
// The factory receives a live getModelId() (not a fixed model), so the observable
// proof of the wiring is that the captured getter reflects the current selection
// — useChat ignores a re-created transport, so the model must be read live.
const createMastraChatTransport = vi.fn(
  (_threadId: string, _getModelId: () => string | undefined) => ({}),
);
vi.mock('./chat-sidebar-helpers', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./chat-sidebar-helpers')>();
  return {
    ...actual,
    createMastraChatTransport: (
      threadId: string,
      getModelId: () => string | undefined,
    ) => createMastraChatTransport(threadId, getModelId),
  };
});

// Replace the vendored Radix-based PromptInputModelSelect* with a controllable
// native <select> test double. We assert the same value/onValueChange contract
// the real components expose (the Radix portal is not reliably drivable under
// happy-dom). The vendored file itself is reused unchanged in production.
vi.mock('~/components/ai-elements/prompt-input', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('~/components/ai-elements/prompt-input')
    >();
  type SelectProps = {
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
    children?: ReactNode;
  };
  return {
    ...actual,
    PromptInputModelSelect: ({
      value,
      onValueChange,
      disabled,
      children,
    }: SelectProps) => (
      <select
        aria-label="model-select"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onValueChange?.(e.currentTarget.value)}
      >
        {children}
      </select>
    ),
    PromptInputModelSelectTrigger: ({ children }: { children?: ReactNode }) => (
      <>{children}</>
    ),
    PromptInputModelSelectValue: () => null,
    PromptInputModelSelectContent: ({ children }: { children?: ReactNode }) => (
      <>{children}</>
    ),
    PromptInputModelSelectItem: ({
      value,
      children,
    }: {
      value: string;
      children?: ReactNode;
    }) => <option value={value}>{children}</option>,
  };
});

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
  regenerate.mockClear();
  clearError.mockClear();
  scheduleToPut.mockClear();
  createMastraChatTransport.mockClear();
  searchState.current = { data: undefined, isLoading: false };
  chatState.status = undefined;
  chatState.error = undefined;
  // Default: models resolved with two options, server-validated selection set.
  modelsState.current = {
    data: {
      models: [
        { id: 'gpt-4o', name: 'gpt-4o' },
        { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
      ],
      defaultModelId: 'gpt-4o',
      selectedModelId: 'gpt-4o-mini',
    },
  };

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
    );
  });
});

describe('ChatSidebar — server error display', () => {
  // The server forwards an AISDKError's provider message (already sanitized).
  const PROVIDER_MESSAGE =
    'model: claude-x_ was not found. Did you mean claude-x?';

  it('renders no error alert when there is no error', () => {
    render(<ChatSidebar />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the heading plus the server-sanitized provider message', () => {
    chatState.error = new Error(PROVIDER_MESSAGE);
    render(<ChatSidebar />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('ai_sidebar.error.title')).toBeInTheDocument();
    expect(screen.getByText(PROVIDER_MESSAGE)).toBeInTheDocument();
  });

  it('retry re-requests via regenerate()', () => {
    chatState.error = new Error(PROVIDER_MESSAGE);
    render(<ChatSidebar />);

    fireEvent.click(screen.getByText('ai_sidebar.error.retry'));

    expect(regenerate).toHaveBeenCalledTimes(1);
  });

  it('dismiss clears the error via clearError()', () => {
    chatState.error = new Error(PROVIDER_MESSAGE);
    render(<ChatSidebar />);

    fireEvent.click(screen.getByLabelText('ai_sidebar.error.dismiss'));

    expect(clearError).toHaveBeenCalledTimes(1);
  });

  it('shows only the generic heading for the unknown sentinel (non-AISDK errors carry no detail)', () => {
    chatState.error = new Error('unknown');
    render(<ChatSidebar />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('ai_sidebar.error.title')).toBeInTheDocument();
    expect(screen.queryByText('unknown')).toBeNull();
  });
});

describe('ChatSidebar — model selector wiring (3.2/3.3/3.4/3.5/3.6)', () => {
  const modelSelect = (): HTMLSelectElement =>
    screen.getByLabelText<HTMLSelectElement>('model-select');

  it('initialises the selector with the server-validated selectedModelId (3.2)', () => {
    render(<ChatSidebar />);

    expect(modelSelect().value).toBe('gpt-4o-mini');
  });

  // The getter passed to the transport factory (2nd arg of the last call).
  const lastModelGetter = (): (() => string | undefined) => {
    const calls = createMastraChatTransport.mock.calls;
    return calls[calls.length - 1][1];
  };

  it('builds the transport with a live getter that reports the initial selectedModelId (3.3/3.4)', () => {
    render(<ChatSidebar />);

    // The factory gets a getter (not a fixed model); reading it now yields the
    // server-validated initial selection. The transport reads it live per
    // request, so sendMessage AND regenerate() both send the current model.
    expect(createMastraChatTransport).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Function),
    );
    expect(lastModelGetter()()).toBe('gpt-4o-mini');
  });

  it('on selection change: persists via scheduleToPut and the live getter reflects the new model WITHOUT re-creating the transport (3.3/3.6)', () => {
    render(<ChatSidebar />);

    const getModelId = lastModelGetter();
    createMastraChatTransport.mockClear();

    act(() => {
      fireEvent.change(modelSelect(), { target: { value: 'gpt-4o' } });
    });

    // Persisted as the user's selection for next visit (3.6).
    expect(scheduleToPut).toHaveBeenCalledWith({
      aiChatSelectedModel: 'gpt-4o',
    });
    // The transport is NOT re-created on a model change (useChat would ignore a
    // new instance anyway); the same live getter now reports the new model, so
    // the next send/regenerate carries it (Critical Issue 1 — 3.3/3.4).
    expect(createMastraChatTransport).not.toHaveBeenCalled();
    expect(getModelId()).toBe('gpt-4o');
    expect(modelSelect().value).toBe('gpt-4o');
  });

  it('shows the single allowed model as selected (3.5)', () => {
    modelsState.current = {
      data: {
        models: [{ id: 'only-model', name: 'only-model' }],
        defaultModelId: 'only-model',
        selectedModelId: 'only-model',
      },
    };
    render(<ChatSidebar />);

    expect(modelSelect().value).toBe('only-model');
    expect(modelSelect().options).toHaveLength(1);
  });

  it('disables the selector until the models resolve', () => {
    modelsState.current = { data: undefined };
    render(<ChatSidebar />);

    expect(modelSelect().disabled).toBe(true);
  });

  it('enables the selector once the models resolve', () => {
    render(<ChatSidebar />);

    expect(modelSelect().disabled).toBe(false);
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
