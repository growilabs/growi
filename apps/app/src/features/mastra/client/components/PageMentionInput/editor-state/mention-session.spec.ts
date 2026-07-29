import { EditorSelection, EditorState } from '@codemirror/state';

import type { MentionSessionState } from '../types';
import {
  isMentionTriggerBoundary,
  mentionSessionField,
} from './mention-session';

/**
 * Build an EditorState with the mention-session field installed and the caret
 * placed at `caret` (defaults to the end of the doc).
 */
const buildState = (doc: string, caret: number = doc.length): EditorState =>
  EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [mentionSessionField],
  });

const sessionOf = (state: EditorState): MentionSessionState =>
  state.field(mentionSessionField);

describe('isMentionTriggerBoundary', () => {
  it('returns true when "@" is at line start (empty text before)', () => {
    expect(isMentionTriggerBoundary('')).toBe(true);
  });

  it('returns true when the char before "@" is a space', () => {
    expect(isMentionTriggerBoundary('hello ')).toBe(true);
  });

  it('returns true when the char before "@" is a newline', () => {
    expect(isMentionTriggerBoundary('hello\n')).toBe(true);
  });

  it('returns true when the char before "@" is a tab', () => {
    expect(isMentionTriggerBoundary('hello\t')).toBe(true);
  });

  it('returns false when the char before "@" is a non-whitespace char (email-like)', () => {
    expect(isMentionTriggerBoundary('foo')).toBe(false);
  });

  it('returns false for a typical email local part', () => {
    expect(isMentionTriggerBoundary('user.name')).toBe(false);
  });
});

describe('mentionSessionField', () => {
  describe('activation at a word boundary (1.1 / 1.5)', () => {
    it('activates with an empty query when "@" is typed at line start (instant activation)', () => {
      const session = sessionOf(buildState('@'));

      expect(session.active).toBe(true);
      expect(session.query).toBe('');
      expect(session.from).toBe(0);
      expect(session.to).toBe(1);
    });

    it('activates with an empty query when "@" follows a space', () => {
      const session = sessionOf(buildState('hello @'));

      expect(session.active).toBe(true);
      expect(session.query).toBe('');
      expect(session.from).toBe(6);
      expect(session.to).toBe(7);
    });

    it('does NOT activate when "@" directly follows a non-whitespace char (email-like)', () => {
      const session = sessionOf(buildState('foo@'));

      expect(session.active).toBe(false);
    });

    it('does NOT activate for a full email-like string before the caret', () => {
      const session = sessionOf(buildState('user@example'));

      expect(session.active).toBe(false);
    });
  });

  describe('query updates while typing (1.3)', () => {
    it('reflects the text typed after "@" as the query', () => {
      const session = sessionOf(buildState('@foo'));

      expect(session.active).toBe(true);
      expect(session.query).toBe('foo');
      expect(session.from).toBe(0);
      expect(session.to).toBe(4);
    });

    it('updates the query as more characters are appended via a transaction', () => {
      const initial = buildState('@fo');
      const updated = initial.update({
        changes: { from: 3, insert: 'o' },
        selection: EditorSelection.cursor(4),
      }).state;

      const session = sessionOf(updated);

      expect(session.active).toBe(true);
      expect(session.query).toBe('foo');
    });

    it('keeps the query equal to the doc slice between "@" and the caret (invariant)', () => {
      const state = buildState('say @bar', 8);
      const session = sessionOf(state);

      expect(session.query).toBe(
        state.doc.sliceString(session.from + 1, session.to),
      );
      expect(session.query).toBe('bar');
    });
  });

  describe('termination on whitespace (1.6)', () => {
    it('deactivates when a space is present in the query span', () => {
      const session = sessionOf(buildState('@foo bar'));

      expect(session.active).toBe(false);
    });

    it('deactivates the session after a space is typed via a transaction', () => {
      const initial = buildState('@foo');
      expect(sessionOf(initial).active).toBe(true);

      const updated = initial.update({
        changes: { from: 4, insert: ' ' },
        selection: EditorSelection.cursor(5),
      }).state;

      expect(sessionOf(updated).active).toBe(false);
    });

    it('never includes a whitespace char in the query when active', () => {
      const session = sessionOf(buildState('@abc'));

      expect(session.active).toBe(true);
      expect(/\s/.test(session.query)).toBe(false);
    });
  });

  describe('termination on "@" deletion / caret leaving the span (1.7)', () => {
    it('deactivates after the "@" is deleted', () => {
      const initial = buildState('@foo');
      expect(sessionOf(initial).active).toBe(true);

      // delete the "@" at position 0
      const updated = initial.update({
        changes: { from: 0, to: 1 },
        selection: EditorSelection.cursor(0),
      }).state;

      expect(sessionOf(updated).active).toBe(false);
    });

    it('deactivates when the caret moves to before the "@"', () => {
      const state = buildState('@foo', 0);

      expect(sessionOf(state).active).toBe(false);
    });

    it('does not activate on an empty document', () => {
      const session = sessionOf(buildState(''));

      expect(session.active).toBe(false);
    });
  });

  describe('robustness with existing mention-like text (5.5)', () => {
    it('does not start a session for an "@" embedded in non-whitespace context', () => {
      // A committed mention path such as "@/Sandbox" preceded by a letter must
      // not (re)trigger when the caret is not at a fresh trigger boundary.
      const session = sessionOf(buildState('see x@/Sandbox'));

      expect(session.active).toBe(false);
    });
  });
});
