import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { EditingClient } from '../../interfaces';

/**
 * Integration tests for the scroll-to-remote-cursor logic extracted from
 * use-collaborative-editor-mode.ts.
 *
 * Covers:
 * - Task 13.2: Scroll function creation and registration
 * - Task 16.2: Integration test for scroll function
 * - Requirements: 6.1, 6.2, 6.3
 */

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

type AwarenessState = {
  editors?: EditingClient;
  cursor?: {
    anchor: Y.RelativePosition;
    head: Y.RelativePosition;
  };
};

type FakeEditorView = {
  dispatch: ReturnType<typeof vi.fn>;
};

// Import the pure function after it is implemented.
// Using a dynamic import wrapper so this test file can compile before
// the implementation exists (RED phase). We test the extracted pure function.
import { createScrollToRemoteCursorFn } from './use-collaborative-editor-mode';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createScrollToRemoteCursorFn — Task 16.2', () => {
  let ydoc: Y.Doc;
  let ytext: Y.Text;
  let states: Map<number, AwarenessState>;
  let awareness: {
    getStates: () => Map<number, AwarenessState>;
    doc: Y.Doc;
  };
  let view: FakeEditorView;

  beforeEach(() => {
    ydoc = new Y.Doc();
    ytext = ydoc.getText('codemirror');
    ytext.insert(0, 'Hello World');

    states = new Map<number, AwarenessState>();
    awareness = {
      getStates: () => states,
      doc: ydoc,
    };

    view = { dispatch: vi.fn() };
  });

  describe('Task 16.2 — configuration callback receives a scroll function', () => {
    it('returns a function (not null/undefined)', () => {
      const scrollFn = createScrollToRemoteCursorFn(
        awareness,
        ydoc,
        () => view as never,
      );
      expect(typeof scrollFn).toBe('function');
    });
  });

  describe('Task 16.2 — calling scrollFn with a valid remote client dispatches scrollIntoView', () => {
    it('dispatches an effect when cursor.head resolves to a valid position', () => {
      const remoteClientId = 42;
      const headIndex = 5;

      const head = Y.createRelativePositionFromTypeIndex(ytext, headIndex);
      const anchor = Y.createRelativePositionFromTypeIndex(ytext, 0);
      states.set(remoteClientId, { cursor: { anchor, head } });

      const scrollFn = createScrollToRemoteCursorFn(
        awareness,
        ydoc,
        () => view as never,
      );
      scrollFn(remoteClientId);

      expect(view.dispatch).toHaveBeenCalledOnce();
      const callArg = view.dispatch.mock.calls[0][0];
      expect(callArg).toHaveProperty('effects');
    });
  });

  describe('Task 16.2 / Req 6.3 — no-op when cursor is absent', () => {
    it('does not dispatch when the client has no cursor in awareness', () => {
      const remoteClientId = 42;
      // Client exists in awareness but has no cursor
      states.set(remoteClientId, {
        editors: {
          clientId: remoteClientId,
          name: 'Bob',
          color: '#0000ff',
          colorLight: '#0000ff33',
        },
      });

      const scrollFn = createScrollToRemoteCursorFn(
        awareness,
        ydoc,
        () => view as never,
      );
      scrollFn(remoteClientId);

      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it('does not dispatch when the client is completely absent from awareness', () => {
      const scrollFn = createScrollToRemoteCursorFn(
        awareness,
        ydoc,
        () => view as never,
      );
      scrollFn(9999);

      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it('does not dispatch when the editor view is not mounted', () => {
      const remoteClientId = 42;
      const head = Y.createRelativePositionFromTypeIndex(ytext, 3);
      const anchor = Y.createRelativePositionFromTypeIndex(ytext, 0);
      states.set(remoteClientId, { cursor: { anchor, head } });

      const scrollFn = createScrollToRemoteCursorFn(
        awareness,
        ydoc,
        () => undefined,
      );
      scrollFn(remoteClientId);

      expect(view.dispatch).not.toHaveBeenCalled();
    });
  });
});
