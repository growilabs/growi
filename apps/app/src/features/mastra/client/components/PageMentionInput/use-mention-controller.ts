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
    // User pages (/user/...) are legitimate mention targets (personal memos,
    // profile pages), so include them; trash pages stay excluded (default).
    includeUserPages: true,
  });

  // While the live query has outrun the debounced one, the search for the latest
  // keystrokes has not started yet (searchKeyword still points at the previous
  // value or null). Treat this window as loading so the panel shows "searching"
  // instead of momentarily flashing "no results" before the request fires.
  const searchPending = isOpen && query.length >= 1 && debouncedQuery !== query;

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

  // Arrow navigation wraps around at the ends (circular), the common combobox
  // behavior (2.2).
  const moveDown = useCallback(() => {
    setHighlightedIndex((index) => {
      const n = candidates.length;
      return n === 0 ? 0 : (index + 1) % n;
    });
  }, [candidates.length]);

  const moveUp = useCallback(() => {
    setHighlightedIndex((index) => {
      const n = candidates.length;
      return n === 0 ? 0 : (index - 1 + n) % n;
    });
  }, [candidates.length]);

  // Set the highlight directly (mouse hover from the candidate list). Negative
  // indices (e.g. downshift reporting "no highlight" on mouse-leave) are ignored
  // so they don't clear the keyboard highlight; valid indices are clamped.
  const setHighlight = useCallback(
    (index: number) => {
      if (index < 0) {
        return;
      }
      setHighlightedIndex(clamp(index, 0, Math.max(candidates.length - 1, 0)));
    },
    [candidates.length],
  );

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
      const mentionEnd = from + path.length;

      // Replace the "@query" span with the path text plus a trailing space, so a
      // new "@" typed right after the chip lands at a word boundary and can start
      // the next mention (Claude Code-style). The atomic decoration covers only
      // the path (inclusive:false), leaving the space as ordinary text; the caret
      // is placed after the space.
      view.dispatch({
        changes: { from, to, insert: `${path} ` },
        effects: addMention.of({
          from,
          to: mentionEnd,
          data: { path, pageId },
        }),
        selection: EditorSelection.cursor(mentionEnd + 1),
      });

      setHighlightedIndex(0);
      setDismissedKey(null);
    },
    [view, session, candidates, highlightedIndex],
  );

  const close = useCallback(() => {
    setDismissedKey(sessionKey);
  }, [sessionKey]);

  return {
    isOpen,
    query,
    highlightedIndex,
    candidates,
    // Fold the debounce-pending window into loading so the panel never flashes
    // "no results" before the request for the latest query fires (#1).
    isLoading: (isLoading ?? false) || searchPending,
    moveUp,
    moveDown,
    setHighlightedIndex: setHighlight,
    commit,
    close,
  };
};
