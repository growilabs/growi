import { useCallback, useEffect, useMemo, useState } from 'react';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useDebounce } from 'usehooks-ts';

import { useSWRxSearch } from '~/stores/search';

import { addMention } from './editor-state/mention-decoration';
import { toPagePathCandidate } from './page-path-candidate';
import type {
  MentionController,
  MentionSessionState,
  PagePathCandidate,
} from './types';

// Debounce window for the search query (Requirement 2.7). Small enough to feel
// responsive while collapsing bursts of keystrokes into a single request.
const SEARCH_DEBOUNCE_MS = 200;

// Number of candidates fetched per query. The candidate panel only needs a
// short list; the search itself is the existing permission-filtered endpoint.
const SEARCH_LIMIT = 10;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Bidirectional bridge between the doc-derived mention session (CodeMirror) and
 * the declarative candidate UI (React). Single owner of search, highlight and
 * commit (Requirements 1.3, 1.4, 2.2, 2.3, 2.7, 7.1, 7.2).
 *
 * The session is the source of truth and is fed in by `PageMentionInput`'s
 * update listener; this hook never mutates it. "Closing" the panel without
 * inserting (Esc / outside click, 2.4) is a React-only `dismissed` flag because
 * the session field is doc-derived and has no dismiss concept.
 */
export const useMentionController = (
  view: EditorView | null,
  session: MentionSessionState,
): MentionController => {
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Identity of the session the user explicitly dismissed (Esc / outside click,
  // 2.4). The session field is doc-derived and has no dismiss concept, so the
  // dismissal lives only in React. Storing the dismissed *identity* (rather than
  // a boolean that must be reset) means a changed identity automatically
  // re-opens the panel without a second render/state cascade.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const sessionKey = `${session.from}:${session.query}:${session.active}`;
  const dismissed = dismissedKey === sessionKey;

  const isOpen = session.active && !dismissed;
  const query = session.query;

  // Debounce the query before it reaches the search key (2.7). When the panel
  // must not search, fall back to an empty string so the debounced value is
  // stable and the key below resolves to null.
  const debouncedQuery = useDebounce(isOpen ? query : '', SEARCH_DEBOUNCE_MS);

  // Search only with a non-empty query while open (1.3 / 1.4). A null key skips
  // the request entirely (SWR conditional fetching). Permission filtering is
  // delegated to the existing `/search` endpoint (7.1 / 7.2).
  const searchKeyword =
    isOpen && debouncedQuery.length >= 1 ? debouncedQuery : null;

  const { data, isLoading } = useSWRxSearch(searchKeyword, null, {
    limit: SEARCH_LIMIT,
  });

  const candidates: readonly PagePathCandidate[] = useMemo(
    () => data?.data.map(toPagePathCandidate) ?? [],
    [data],
  );

  // Keep the highlight within bounds and reset to the top whenever the
  // candidate set changes (2.2).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed on candidate identity, not on highlightedIndex
  useEffect(() => {
    setHighlightedIndex(0);
  }, [candidates]);

  const moveDown = useCallback(() => {
    setHighlightedIndex((index) =>
      clamp(index + 1, 0, Math.max(candidates.length - 1, 0)),
    );
  }, [candidates.length]);

  const moveUp = useCallback(() => {
    setHighlightedIndex((index) => clamp(index - 1, 0, candidates.length - 1));
  }, [candidates.length]);

  const commit = useCallback(
    (index?: number) => {
      if (view == null || !session.active) {
        return;
      }
      const candidate = candidates[index ?? highlightedIndex];
      if (candidate == null) {
        return;
      }

      const { from, to } = session;
      const { path, pageId } = candidate;
      const insertEnd = from + path.length;

      // Replace the "@query" span with the path text, register the atomic
      // mention decoration over the inserted range, and place the caret right
      // after it (2.3 / 3.1).
      view.dispatch({
        changes: { from, to, insert: path },
        effects: addMention.of({
          from,
          to: insertEnd,
          data: { path, pageId },
        }),
        selection: EditorSelection.cursor(insertEnd),
      });

      setHighlightedIndex(0);
      setDismissedKey(null);
    },
    [view, session, candidates, highlightedIndex],
  );

  const close = useCallback(() => {
    setDismissedKey(sessionKey);
  }, [sessionKey]);

  // Caret coordinates for positioning the panel; owned here because only the
  // view can compute them. Layout may be 0 in happy-dom — acceptable.
  const coords = useMemo(() => {
    if (!isOpen || view == null) {
      return null;
    }
    const c = view.coordsAtPos(session.from);
    if (c == null) {
      return null;
    }
    return { left: c.left, top: c.top, bottom: c.bottom };
  }, [isOpen, view, session.from]);

  return {
    isOpen,
    query,
    highlightedIndex,
    coords,
    candidates,
    isLoading: isLoading ?? false,
    moveUp,
    moveDown,
    commit,
    close,
  };
};
