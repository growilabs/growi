// @vitest-environment happy-dom

import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';

import type { ChatSidebarStatus } from '../../status/chat-sidebar';
import { ChatSidebar } from './ChatSidebar';

// --- sendMessage spy (the send-flow boundary we assert against) ------------
const sendMessage = vi.fn();

// @ai-sdk/react useChat: a controllable object exposing the sendMessage spy.
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    status: undefined,
    regenerate: vi.fn(),
    setMessages: vi.fn(),
  }),
}));

// Chat sidebar status: provide an opened sidebar with an assistant so
// ChatSidebar renders its header + input without reaching into jotai.
vi.mock('../../status/chat-sidebar', () => ({
  useChatSidebarStatus: (): ChatSidebarStatus => ({
    isOpened: true,
    aiAssistantData: undefined,
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

beforeEach(() => {
  sendMessage.mockClear();
  searchState.current = { data: undefined, isLoading: false };
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
    expect(row).not.toBeNull();
    fireEvent.click(row as Element);

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
