// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ChatStatus } from 'ai';
import { mock } from 'vitest-mock-extended';

import type { ChatModelsResponse } from '~/features/mastra/interfaces/chat-models-response';
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
// models (cross-provider), the server-validated initial selection, and the
// loading state. The wire shape is the shared ChatModelsResponse.
const { modelsState } = vi.hoisted(() => ({
  modelsState: {
    current: {
      data: undefined as ChatModelsResponse | undefined,
    },
  },
}));
vi.mock('../../stores/models', () => ({
  useSWRxChatModels: () => modelsState.current,
}));

// Persisted selection write boundary. The contract is "a model change calls
// scheduleToPut({ aiChatSelectedModelKey })"; the debounce + HTTP PUT live in the
// shared service (reused unchanged), so the spy is the right boundary (Req 4.4).
const scheduleToPut = vi.fn();
vi.mock('~/client/services/user-ui-settings', () => ({
  scheduleToPut: (...args: unknown[]) => scheduleToPut(...args),
}));

// Spy on the transport factory while keeping the pure label/error helpers real.
// The factory receives a live getModelKey() (not a fixed model), so the observable
// proof of the wiring is that the captured getter reflects the current selection
// — useChat ignores a re-created transport, so the model must be read live.
const createMastraChatTransport = vi.fn(
  (_threadId: string, _getModelKey: () => string | undefined) => ({}),
);
vi.mock('./chat-sidebar-helpers', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./chat-sidebar-helpers')>();
  return {
    ...actual,
    createMastraChatTransport: (
      threadId: string,
      getModelKey: () => string | undefined,
    ) => createMastraChatTransport(threadId, getModelKey),
  };
});

// Replace the vendored Radix-based PromptInputModelSelect* with a controllable
// native <select> test double. We assert the same value/onValueChange contract
// the real components expose (the Radix portal is not reliably drivable under
// happy-dom). The vendored file itself is reused unchanged in production, and its
// real grouped rendering is covered by prompt-input's own spec (task 7.1).
//
// Grouping is modelled with native <optgroup> elements: each provider group
// renders an <optgroup label={provider}> heading and its models render as
// <option value={modelKey}>. Keeping the <option>s as direct <select> children
// makes the value / change contract behave exactly like a real native select,
// while the optgroup labels expose the per-provider headings for assertion
// (4.1/4.2). The trigger is wrapped so its computed "provider · modelId" label
// is queryable (4.2).
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
      <span data-testid="model-trigger">{children}</span>
    ),
    PromptInputModelSelectValue: () => null,
    PromptInputModelSelectContent: ({ children }: { children?: ReactNode }) => (
      <>{children}</>
    ),
    PromptInputModelSelectGroup: ({ children }: { children?: ReactNode }) => (
      <>{children}</>
    ),
    PromptInputModelSelectLabel: ({ children }: { children?: ReactNode }) => (
      <optgroup label={typeof children === 'string' ? children : undefined} />
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
  // Default: models resolved across TWO providers (openai + anthropic), with a
  // server-validated cross-provider selection set (Req 4.1/4.2/4.4).
  modelsState.current = {
    data: {
      models: [
        {
          key: 'openai/gpt-4o',
          provider: 'openai',
          modelId: 'gpt-4o',
          displayName: 'GPT-4o',
        },
        {
          key: 'openai/gpt-4o-mini',
          provider: 'openai',
          modelId: 'gpt-4o-mini',
          displayName: 'GPT-4o mini',
        },
        {
          key: 'anthropic/claude-sonnet-4',
          provider: 'anthropic',
          modelId: 'claude-sonnet-4',
          displayName: 'Claude Sonnet 4',
        },
      ],
      selectedModelKey: 'openai/gpt-4o-mini',
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

describe('ChatSidebar — cross-provider model selector (4.1/4.2/4.4/4.7)', () => {
  const modelSelect = (): HTMLSelectElement =>
    screen.getByLabelText<HTMLSelectElement>('model-select');

  const modelTrigger = (): HTMLElement => screen.getByTestId('model-trigger');

  // The provider group headings the selector renders, in DOM order (modelled as
  // native <optgroup label> in the test double — see the prompt-input mock).
  const providerGroupLabels = (container: HTMLElement): (string | null)[] =>
    Array.from(container.querySelectorAll('optgroup')).map((g) =>
      g.getAttribute('label'),
    );

  it('presents allowed models of every provider, grouped by provider, in one selector (4.1/4.2)', () => {
    const { container } = render(<ChatSidebar />);

    // A provider group heading per provider that owns a model, in fixed slot
    // order; providers that own no model contribute no group (google/azure-openai
    // are absent from the fixture).
    expect(providerGroupLabels(container)).toEqual(['OpenAI', 'Anthropic']);

    // Options span BOTH providers and each carries its modelKey as the value the
    // client sends back (4.1/4.2).
    const options = Array.from(
      modelSelect().querySelectorAll<HTMLOptionElement>('option'),
    );
    expect(options.map((o) => o.value)).toEqual([
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4',
    ]);
    // Options are labelled by the official display name (the value stays the key).
    expect(options.map((o) => o.textContent)).toEqual([
      'GPT-4o',
      'GPT-4o mini',
      'Claude Sonnet 4',
    ]);
  });

  it('initialises the selector on the server-validated selectedModelKey (4.4)', () => {
    render(<ChatSidebar />);

    expect(modelSelect().value).toBe('openai/gpt-4o-mini');
  });

  it('shows the selected entry as "provider · modelId" in the closed trigger (4.2)', () => {
    render(<ChatSidebar />);

    // The trigger names the provider so the same modelId under different
    // providers stays distinguishable when the menu is closed.
    expect(modelTrigger()).toHaveTextContent('OpenAI · GPT-4o mini');
  });

  // The getter passed to the transport factory (2nd arg of the last call).
  const lastModelGetter = (): (() => string | undefined) => {
    const calls = createMastraChatTransport.mock.calls;
    return calls[calls.length - 1][1];
  };

  it('builds the transport with a live getter that reports the initial selectedModelKey (4.7)', () => {
    render(<ChatSidebar />);

    // The factory gets a getter (not a fixed model); reading it now yields the
    // server-validated initial selection. The transport reads it live per
    // request, so sendMessage AND regenerate() both send the current modelKey.
    expect(createMastraChatTransport).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Function),
    );
    expect(lastModelGetter()()).toBe('openai/gpt-4o-mini');
  });

  it('on cross-provider selection change: persists the modelKey via scheduleToPut and the live getter reflects it WITHOUT re-creating the transport (4.4/4.7)', () => {
    render(<ChatSidebar />);

    const getModelKey = lastModelGetter();
    createMastraChatTransport.mockClear();

    act(() => {
      fireEvent.change(modelSelect(), {
        target: { value: 'anthropic/claude-sonnet-4' },
      });
    });

    // Persisted (uniquely, down to the provider) as the user's selection for the
    // next visit (4.4).
    expect(scheduleToPut).toHaveBeenCalledWith({
      aiChatSelectedModelKey: 'anthropic/claude-sonnet-4',
    });
    // The transport is NOT re-created on a model change (useChat would ignore a
    // new instance anyway); the same live getter now reports the new modelKey, so
    // the next send/regenerate carries it — mid-thread cross-provider switch (4.7).
    expect(createMastraChatTransport).not.toHaveBeenCalled();
    expect(getModelKey()).toBe('anthropic/claude-sonnet-4');
    expect(modelSelect().value).toBe('anthropic/claude-sonnet-4');
    // The trigger follows the new selection, still provider-qualified.
    expect(modelTrigger()).toHaveTextContent('Anthropic · Claude Sonnet 4');
  });

  it('shows the single allowed model as selected (4.1)', () => {
    modelsState.current = {
      data: {
        models: [
          {
            key: 'openai/only-model',
            provider: 'openai',
            modelId: 'only-model',
            displayName: 'Only Model',
          },
        ],
        selectedModelKey: 'openai/only-model',
      },
    };
    render(<ChatSidebar />);

    expect(modelSelect().value).toBe('openai/only-model');
    expect(modelSelect().options).toHaveLength(1);
    expect(modelTrigger()).toHaveTextContent('OpenAI · Only Model');
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
