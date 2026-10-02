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
import { mentionSessionField } from './editor-state/mention-session';
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

    it('includes user pages in the search scope', () => {
      renderHook(() =>
        useMentionController(null, activeSession({ query: 'foo' })),
      );

      act(() => {
        vi.runAllTimers();
      });

      // /user/... pages (personal memos etc.) are valid mention targets, so
      // the hook must opt in (the store default is includeUserPages: false).
      const configurations = useSWRxSearchMock.mock.calls.at(-1)?.[2];
      expect(configurations).toMatchObject({ includeUserPages: true });
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

      // pageId/path are the mapped contract; `creator` is carried through from
      // the (mocked) search result and asserted separately in the mapper spec.
      expect(result.current.candidates).toHaveLength(2);
      expect(result.current.candidates[0]).toMatchObject({
        pageId: 'id-a',
        path: '/foo/a',
      });
      expect(result.current.candidates[1]).toMatchObject({
        pageId: 'id-b',
        path: '/foo/b',
      });
    });

    it('reflects isLoading from the mocked SWR', () => {
      setSearchResult({ data: undefined, isLoading: true });

      const { result } = renderHook(() =>
        useMentionController(null, activeSession({ query: 'foo' })),
      );

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('loading state during debounce (#1)', () => {
    it('reports loading while the live query has outrun the debounced search', () => {
      // SWR stays idle (no result configured). Without folding the pending
      // window into loading, the panel would see an empty candidate set the
      // instant the user types and flash "no results" before the request fires.
      const { result, rerender } = renderHook(
        ({ s }) => useMentionController(null, s),
        { initialProps: { s: activeSession({ query: '' }) } },
      );

      // User types the first query characters: the live query changes but the
      // debounce has not settled, so the search for "foo" has not started yet.
      act(() => rerender({ s: activeSession({ query: 'foo' }) }));

      // Contract: the panel is told it is loading (→ "searching"), not that the
      // result set is empty (→ "no results").
      expect(result.current.isLoading).toBe(true);
      expect(result.current.candidates).toHaveLength(0);

      // Once the debounce flushes, loading reflects the real (idle) SWR state.
      act(() => {
        vi.runAllTimers();
      });
      expect(result.current.isLoading).toBe(false);
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

    it('starts highlighted at 0 and moveDown advances, wrapping at the end', () => {
      const { result } = withTwoCandidates();
      expect(result.current.highlightedIndex).toBe(0);

      act(() => result.current.moveDown());
      expect(result.current.highlightedIndex).toBe(1);

      // Wrap around from the last index back to the first.
      act(() => result.current.moveDown());
      expect(result.current.highlightedIndex).toBe(0);
    });

    it('moveUp decrements, wrapping from the first index to the last', () => {
      const { result } = withTwoCandidates();

      // Wrap around from the first index to the last.
      act(() => result.current.moveUp());
      expect(result.current.highlightedIndex).toBe(1);

      act(() => result.current.moveUp());
      expect(result.current.highlightedIndex).toBe(0);
    });

    it('stays at 0 when wrapping with a single candidate', () => {
      setSearchResult({
        data: buildSearchResult([{ id: 'only', path: '/only' }]),
        isLoading: false,
      });
      const { result } = renderHook(() =>
        useMentionController(null, activeSession({ query: 'foo' })),
      );

      // With one candidate, both directions wrap to the single index 0
      // (guards against modulo-by-1 / off-by-one regressions).
      act(() => result.current.moveDown());
      expect(result.current.highlightedIndex).toBe(0);
      act(() => result.current.moveUp());
      expect(result.current.highlightedIndex).toBe(0);
    });

    it('setHighlightedIndex sets a valid index and ignores negatives', () => {
      const { result } = withTwoCandidates();

      act(() => result.current.setHighlightedIndex(1));
      expect(result.current.highlightedIndex).toBe(1);

      // Negative (e.g. downshift "no highlight" on mouse-leave) is ignored.
      act(() => result.current.setHighlightedIndex(-1));
      expect(result.current.highlightedIndex).toBe(1);
    });
  });

  describe('commit (2.3 / 3.1)', () => {
    it('dispatches a transaction inserting the path with the addMention effect', () => {
      setSearchResult({
        data: buildSearchResult([{ id: 'id-a', path: '/foo/a' }]),
        isLoading: false,
      });

      // Real EditorView with the session field installed (as in production):
      // commit reads the live session from the editor state, not from the
      // React-mirrored prop.
      const view = new EditorView({
        state: EditorState.create({
          doc: '@foo',
          selection: EditorSelection.cursor(4),
          extensions: [mentionSessionField],
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

      // The path (plus a trailing space) replaced the "@foo" query span so the
      // next "@" can start a new mention at a word boundary.
      expect(view.state.doc.toString()).toBe('/foo/a ');
      // Caret is placed after the trailing space.
      expect(view.state.selection.main.head).toBe('/foo/a '.length);

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

    it('replaces the span of the LIVE session even when the mirrored prop is stale', () => {
      setSearchResult({
        data: buildSearchResult([{ id: 'id-a', path: '/foo/a' }]),
        isLoading: false,
      });

      const view = new EditorView({
        state: EditorState.create({
          doc: '@foo',
          selection: EditorSelection.cursor(4),
          extensions: [mentionSessionField],
        }),
      });

      const { result } = renderHook(() =>
        // The mirrored prop lags behind the doc (e.g. a transaction landed
        // after the last render): its positions no longer match "@foo".
        useMentionController(
          view,
          activeSession({ from: 1, to: 3, query: 'fo' }),
        ),
      );

      act(() => result.current.commit());

      // The whole "@foo" span — per the live session [0, 4] — was replaced,
      // not the stale [1, 3] span from the prop.
      expect(view.state.doc.toString()).toBe('/foo/a ');
      view.destroy();
    });

    it('does nothing (doc/selection unchanged) when there is no candidate', () => {
      setSearchResult({ data: buildSearchResult([]), isLoading: false });

      const view = new EditorView({
        state: EditorState.create({
          doc: '@foo',
          selection: EditorSelection.cursor(4),
          extensions: [mentionSessionField],
        }),
      });

      const { result } = renderHook(() =>
        useMentionController(view, activeSession({ query: 'foo' })),
      );

      act(() => result.current.commit());

      // Observable contract: nothing was inserted and the caret did not move.
      expect(view.state.doc.toString()).toBe('@foo');
      expect(view.state.selection.main.head).toBe(4);
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
