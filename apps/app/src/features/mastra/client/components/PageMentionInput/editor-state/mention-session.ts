import type { EditorState } from '@codemirror/state';
import { StateField } from '@codemirror/state';

import type { MentionSessionState } from '../types';

/**
 * The single "no active session" value. Exported so consumers (e.g. the React
 * adapter's initial state) share this definition instead of re-declaring it.
 */
export const INACTIVE_MENTION_SESSION: MentionSessionState = {
  active: false,
  from: -1,
  to: -1,
  query: '',
};

const MENTION_TRIGGER = '@';

/**
 * Pure trigger-boundary rule (Requirement 1.5).
 *
 * Given the text immediately preceding a `@`, return true iff the `@` sits at a
 * word boundary: either at line start (no preceding char) or directly after a
 * whitespace character. An email-like string (`foo@`) yields a non-whitespace
 * char before `@`, so it does not trigger.
 */
export const isMentionTriggerBoundary = (textBefore: string): boolean => {
  if (textBefore.length === 0) {
    return true;
  }
  const prevChar = textBefore[textBefore.length - 1];
  return /\s/.test(prevChar);
};

/**
 * Recompute the mention session purely from the document text and the main
 * selection head. The doc/selection is the source of truth; this derives the
 * transient `@` query session from it on every transaction.
 */
const computeSession = (state: EditorState): MentionSessionState => {
  const sel = state.selection.main;

  // A session is only meaningful for a collapsed caret; a non-empty selection
  // means the user is selecting/replacing text, not typing a query.
  if (!sel.empty) {
    return INACTIVE_MENTION_SESSION;
  }

  const caret = sel.head;
  const line = state.doc.lineAt(caret);

  // Scan backward from the caret within the current line to find the most
  // recent `@`. A whitespace char terminates the scan: the query may not span
  // whitespace (1.6), so any `@` before a space cannot own the caret.
  let atPos = -1;
  for (let pos = caret - 1; pos >= line.from; pos--) {
    const ch = state.doc.sliceString(pos, pos + 1);
    if (ch === MENTION_TRIGGER) {
      atPos = pos;
      break;
    }
    if (/\s/.test(ch)) {
      // Whitespace before any `@` → caret is not inside a query span (1.6).
      return INACTIVE_MENTION_SESSION;
    }
  }

  if (atPos < 0) {
    return INACTIVE_MENTION_SESSION;
  }

  // The `@` must sit at a trigger boundary (1.1 / 1.5). The char before `@` is
  // examined; line start (atPos === line.from) yields empty textBefore.
  const charBefore =
    atPos > line.from ? state.doc.sliceString(atPos - 1, atPos) : '';
  if (!isMentionTriggerBoundary(charBefore)) {
    return INACTIVE_MENTION_SESSION;
  }

  const from = atPos;
  const to = caret;
  const query = state.doc.sliceString(from + 1, to);

  return {
    active: true,
    from,
    to,
    query,
  };
};

/**
 * StateField tracking the active `@` mention session (Requirements 1.1, 1.5,
 * 1.6, 1.7, 5.5).
 *
 * The value is recomputed from scratch on every transaction so that activation,
 * query updates, whitespace termination, and `@`/caret-span loss all fall out
 * of a single pure derivation rather than incremental state mutation.
 *
 * Invariants (per design): when `active`, `query === doc.sliceString(from+1, to)`
 * and `query` contains no whitespace.
 */
export const mentionSessionField: StateField<MentionSessionState> =
  StateField.define<MentionSessionState>({
    create(state) {
      return computeSession(state);
    },
    update(_value, tr) {
      return computeSession(tr.state);
    },
  });
