// @vitest-environment happy-dom

import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, renderHook } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';

import { addMention } from './editor-state/mention-decoration';
import type { MentionSessionState } from './types';
import { useMentionController } from './use-mention-controller';

// --- Search store mock (the data boundary) ---------------------------------
// `useSWRxSearch` is the single search dependency. We mock it as a spy whose
// return value we control per-test, and assert on the key it is called with.
const useSWRxSearchMock = vi.fn();
vi.mock('~/stores/search', () => ({
  useSWRxSearch: (...args: unknown[]) => useSWRxSearchMock(...args),
}));

type SwrReturn = {
  data?: IFormattedSearchResult;
  isLoading?: boolean;
};

const setSearchResult = (value: SwrReturn): void => {
  useSWRxSearchMock.mockReturnValue(value);
};

/**
 * Build a minimal search result page for the mocked SWR return.
 */
const buildSearchMeta = (id: string, path: string): IPageWithSearchMeta =>
  mock<IPageWithSearchMeta>({
    data: mock<IPageWithSearchMeta['data']>({ _id: id, path }),
  });

const buildSearchResult = (
  pages: ReadonlyArray<{ id: string; path: string }>,
): IFormattedSearchResult =>
  mock<IFormattedSearchResult>({
    data: pages.map((p) => buildSearchMeta(p.id, p.path)),
  });

const activeSession = (
  overrides: Partial<MentionSessionState> = {},
): MentionSessionState => ({
  active: true,
  from: 0,
  to: 4,
  query: 'foo',
  ...overrides,
});

const inactiveSession = (): MentionSessionState => ({
  active: false,
  from: -1,
  to: -1,
  query: '',
});

/**
 * Most recent non-null keyword `useSWRxSearch` was invoked with.
 */
const lastSearchKeyword = (): unknown =>
  useSWRxSearchMock.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.useFakeTimers();
  useSWRxSearchMock.mockReset();
  setSearchResult({ data: undefined, isLoading: false });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('useMentionController', () => {
  describe('search invocation (1.3 / 1.4 / 7.x)', () => {
    it('searches with the query when open and query has >= 1 char', () => {
      const { result } = renderHook(() =>
        useMentionController(null, activeSession({ query: 'foo' })),
      );

      // Flush the debounce so the keyword reaches the search key.
      act(() => {
        vi.runAllTimers();
      });

      expect(result.current.query).toBe('foo');
      expect(lastSearchKeyword()).toBe('foo');
    });

    it('does NOT search (null key) when the query is empty', () => {
      renderHook(() =>
        useMentionController(null, activeSession({ query: '' })),
      );

      act(() => {
        vi.runAllTimers();
      });

      expect(lastSearchKeyword()).toBeNull();
    });

    it('does NOT search (null key) when the session is inactive', () => {
      renderHook(() => useMentionController(null, inactiveSession()));

      act(() => {
        vi.runAllTimers();
      });

      expect(lastSearchKeyword()).toBeNull();
    });
  });

  describe('candidate mapping', () => {
    it('maps the mocked search data into PagePathCandidate[]', () => {
      setSearchResult({
        data: buildSearchResult([
          { id: 'id-a', path: '/foo/a' },
          { id: 'id-b', path: '/foo/b' },
        ]),
        isLoading: false,
      });

      const { result } = renderHook(() =>
        useMentionController(null, activeSession({ query: 'foo' })),
      );

      expect(result.current.candidates).toEqual([
        { pageId: 'id-a', path: '/foo/a' },
        { pageId: 'id-b', path: '/foo/b' },
      ]);
    });

    it('reflects isLoading from the mocked SWR', () => {
      setSearchResult({ data: undefined, isLoading: true });

      const { result } = renderHook(() =>
        useMentionController(null, activeSession({ query: 'foo' })),
      );

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('highlight navigation (2.2)', () => {
    const withTwoCandidates = () => {
      setSearchResult({
        data: buildSearchResult([
          { id: 'id-a', path: '/foo/a' },
          { id: 'id-b', path: '/foo/b' },
        ]),
        isLoading: false,
      });
      return renderHook(() =>
        useMentionController(null, activeSession({ query: 'foo' })),
      );
    };

    it('starts highlighted at 0 and moveDown advances within bounds', () => {
      const { result } = withTwoCandidates();
      expect(result.current.highlightedIndex).toBe(0);

      act(() => result.current.moveDown());
      expect(result.current.highlightedIndex).toBe(1);

      // Clamp at the last index.
      act(() => result.current.moveDown());
      expect(result.current.highlightedIndex).toBe(1);
    });

    it('moveUp decrements and clamps at 0', () => {
      const { result } = withTwoCandidates();

      act(() => result.current.moveDown());
      expect(result.current.highlightedIndex).toBe(1);

      act(() => result.current.moveUp());
      expect(result.current.highlightedIndex).toBe(0);

      act(() => result.current.moveUp());
      expect(result.current.highlightedIndex).toBe(0);
    });
  });

  describe('commit (2.3 / 3.1)', () => {
    it('dispatches a transaction inserting the path with the addMention effect', () => {
      setSearchResult({
        data: buildSearchResult([{ id: 'id-a', path: '/foo/a' }]),
        isLoading: false,
      });

      // Real EditorView so the transaction is genuinely applied to a doc.
      const view = new EditorView({
        state: EditorState.create({
          doc: '@foo',
          selection: EditorSelection.cursor(4),
        }),
      });
      const dispatchSpy = vi.spyOn(view, 'dispatch');

      const { result } = renderHook(() =>
        useMentionController(
          view,
          activeSession({ from: 0, to: 4, query: 'foo' }),
        ),
      );

      act(() => result.current.commit());

      // The path replaced the "@foo" query span.
      expect(view.state.doc.toString()).toBe('/foo/a');

      // The dispatched transaction carried the addMention effect over the
      // inserted path range.
      const spec = dispatchSpy.mock.calls.at(0)?.[0];
      const effects = Array.isArray(spec?.effects)
        ? spec?.effects
        : spec?.effects != null
          ? [spec.effects]
          : [];
      const mentionEffect = effects.find((e) => e.is(addMention));
      expect(mentionEffect).toBeDefined();
      expect(mentionEffect?.value).toMatchObject({
        from: 0,
        to: '/foo/a'.length,
        data: { path: '/foo/a', pageId: 'id-a' },
      });

      view.destroy();
    });

    it('does nothing when there is no candidate', () => {
      setSearchResult({ data: buildSearchResult([]), isLoading: false });

      const view = new EditorView({
        state: EditorState.create({ doc: '@foo' }),
      });
      const dispatchSpy = vi.spyOn(view, 'dispatch');

      const { result } = renderHook(() =>
        useMentionController(view, activeSession({ query: 'foo' })),
      );

      act(() => result.current.commit());

      expect(dispatchSpy).not.toHaveBeenCalled();
      view.destroy();
    });
  });

  describe('close (2.4)', () => {
    it('hides the panel (isOpen false) while the session stays active', () => {
      const session = activeSession({ from: 0, to: 4, query: 'foo' });
      const { result, rerender } = renderHook(
        ({ s }) => useMentionController(null, s),
        { initialProps: { s: session } },
      );

      expect(result.current.isOpen).toBe(true);

      // Settle the pending debounce timer inside act before asserting.
      act(() => {
        vi.runAllTimers();
      });

      act(() => result.current.close());
      expect(result.current.isOpen).toBe(false);

      // Re-rendering with the SAME session identity keeps it closed.
      act(() => rerender({ s: session }));
      expect(result.current.isOpen).toBe(false);

      act(() => {
        vi.runAllTimers();
      });
    });

    it('re-opens when the session changes (user keeps typing)', () => {
      const { result, rerender } = renderHook(
        ({ s }) => useMentionController(null, s),
        {
          initialProps: { s: activeSession({ from: 0, to: 4, query: 'foo' }) },
        },
      );

      act(() => {
        vi.runAllTimers();
      });

      act(() => result.current.close());
      expect(result.current.isOpen).toBe(false);

      // Typing extends the query → new session identity → panel re-opens.
      act(() =>
        rerender({ s: activeSession({ from: 0, to: 5, query: 'foob' }) }),
      );
      expect(result.current.isOpen).toBe(true);

      act(() => {
        vi.runAllTimers();
      });
    });
  });
});
