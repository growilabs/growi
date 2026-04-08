import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';

import type { EditingClient } from '../../../interfaces';
import { yRichCursors } from './y-rich-cursors';

/**
 * Integration tests for collaborative awareness flow.
 *
 * Covers:
 * - Task 5.1: Awareness update flow to EditingUserList with multiple simulated clients
 * - Task 5.2: Cursor position broadcasting verification
 * - Requirements: 1.3, 2.1, 2.4, 3.5, 3.6
 *
 * Note: These tests exercise the awareness state management logic
 * without requiring a live WebSocket connection or a real CodeMirror view.
 */

// ---------------------------------------------------------------------------
// Minimal awareness stub matching y-protocols/awareness interface
// ---------------------------------------------------------------------------

type AwarenessState = {
  editors?: EditingClient;
  cursor?: { anchor: Y.RelativePosition; head: Y.RelativePosition };
};

class FakeAwareness {
  private states = new Map<number, AwarenessState>();
  private localClientId: number;
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly doc: Y.Doc;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.localClientId = doc.clientID;
    this.states.set(this.localClientId, {});
  }

  get clientID(): number {
    return this.localClientId;
  }

  getStates(): Map<number, AwarenessState> {
    return this.states;
  }

  getLocalState(): AwarenessState | null {
    return this.states.get(this.localClientId) ?? null;
  }

  setLocalState(state: AwarenessState | null): void {
    if (state == null) {
      this.states.delete(this.localClientId);
    } else {
      this.states.set(this.localClientId, state);
    }
  }

  setLocalStateField<K extends keyof AwarenessState>(
    field: K,
    value: AwarenessState[K],
  ): void {
    const current = this.states.get(this.localClientId) ?? {};
    this.states.set(this.localClientId, { ...current, [field]: value });
    this.emit('change', [
      { added: [], updated: [this.localClientId], removed: [] },
    ]);
  }

  /** Simulate a remote client setting their state */
  setRemoteClientState(clientId: number, state: AwarenessState | null): void {
    const isNew = !this.states.has(clientId);
    if (state == null) {
      this.states.delete(clientId);
      this.emit('change', [{ added: [], updated: [], removed: [clientId] }]);
      this.emit('update', [{ added: [], updated: [], removed: [clientId] }]);
    } else {
      this.states.set(clientId, state);
      this.emit('change', [
        {
          added: isNew ? [clientId] : [],
          updated: isNew ? [] : [clientId],
          removed: [],
        },
      ]);
      this.emit('update', [
        {
          added: isNew ? [clientId] : [],
          updated: isNew ? [] : [clientId],
          removed: [],
        },
      ]);
    }
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: string, args: unknown[]): void {
    this.listeners.get(event)?.forEach((fn) => {
      fn(...args);
    });
  }
}

// ---------------------------------------------------------------------------
// emitEditorList helper (mirrors the fixed implementation)
// ---------------------------------------------------------------------------

function buildEditorList(awareness: FakeAwareness): EditingClient[] {
  return Array.from(awareness.getStates().values())
    .map((v) => v.editors)
    .filter((v): v is EditingClient => v != null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const makeClient = (id: number, name: string): EditingClient => ({
  clientId: id,
  name,
  color: `#${id.toString(16).padStart(6, '0')}`,
  colorLight: `#${id.toString(16).padStart(6, '0')}33`,
});

describe('Task 5.1 — Awareness update flow to EditingUserList', () => {
  let ydoc: Y.Doc;
  let awareness: FakeAwareness;
  const LOCAL_CLIENT_ID = 1;

  beforeEach(() => {
    ydoc = new Y.Doc({ guid: 'test-doc' });
    // Force a stable clientID for the local client
    Object.defineProperty(ydoc, 'clientID', { value: LOCAL_CLIENT_ID });
    awareness = new FakeAwareness(ydoc);
  });

  it('displays both users when two clients both have state.editors set', () => {
    const client1 = makeClient(LOCAL_CLIENT_ID, 'Alice');
    const client2 = makeClient(2, 'Bob');

    awareness.setLocalStateField('editors', client1);
    awareness.setRemoteClientState(2, { editors: client2 });

    const list = buildEditorList(awareness);
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.name)).toContain('Alice');
    expect(list.map((c) => c.name)).toContain('Bob');
  });

  it('shows only the client with editors when one client has no editors field yet', () => {
    const client1 = makeClient(LOCAL_CLIENT_ID, 'Alice');

    awareness.setLocalStateField('editors', client1);
    // Client 2 connects but has not broadcast editors yet
    awareness.setRemoteClientState(2, {});

    const list = buildEditorList(awareness);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Alice');
  });

  it('emits updated list when a remote client sets their editors field', () => {
    const onEditorsUpdated = vi.fn();
    awareness.on('update', () => {
      onEditorsUpdated(buildEditorList(awareness));
    });

    const remoteClient = makeClient(2, 'Bob');
    awareness.setRemoteClientState(2, { editors: remoteClient });

    expect(onEditorsUpdated).toHaveBeenCalled();
    const lastCall = onEditorsUpdated.mock.calls.at(-1)?.[0] as EditingClient[];
    expect(lastCall.map((c) => c.name)).toContain('Bob');
  });

  it('user presence information broadcast via state.editors is accessible from awareness state', () => {
    const client1 = makeClient(LOCAL_CLIENT_ID, 'Alice');
    awareness.setLocalStateField('editors', client1);

    const localState = awareness.getLocalState();
    expect(localState?.editors).toEqual(client1);
  });
});

describe('Task 5.2 — Cursor position broadcasting', () => {
  let ydoc: Y.Doc;
  let awareness: FakeAwareness;

  beforeEach(() => {
    ydoc = new Y.Doc({ guid: 'test-doc-cursor' });
    Object.defineProperty(ydoc, 'clientID', { value: 10 });
    awareness = new FakeAwareness(ydoc);
  });

  it('updates state.cursor when setLocalStateField("cursor", ...) is called', () => {
    const ytext = ydoc.getText('codemirror');
    ytext.insert(0, 'Hello World');

    const anchor = Y.createRelativePositionFromTypeIndex(ytext, 0);
    const head = Y.createRelativePositionFromTypeIndex(ytext, 5);

    awareness.setLocalStateField('cursor', { anchor, head });

    const localState = awareness.getLocalState();
    expect(localState?.cursor).not.toBeNull();
    expect(localState?.cursor?.anchor).toBeDefined();
    expect(localState?.cursor?.head).toBeDefined();
  });

  it('reconstructs absolute position from stored relative position', () => {
    const ytext = ydoc.getText('codemirror');
    ytext.insert(0, 'Hello World');

    const anchorIndex = 3;
    const headIndex = 7;
    const anchor = Y.createRelativePositionFromTypeIndex(ytext, anchorIndex);
    const head = Y.createRelativePositionFromTypeIndex(ytext, headIndex);

    awareness.setLocalStateField('cursor', { anchor, head });

    const stored = awareness.getLocalState()?.cursor;
    expect(stored).toBeDefined();

    const restoredAnchor = Y.createAbsolutePositionFromRelativePosition(
      stored?.anchor,
      ydoc,
    );
    const restoredHead = Y.createAbsolutePositionFromRelativePosition(
      stored?.head,
      ydoc,
    );

    expect(restoredAnchor?.index).toBe(anchorIndex);
    expect(restoredHead?.index).toBe(headIndex);
  });

  it('remote client awareness state with state.editors and state.cursor is accessible', () => {
    const ytext = ydoc.getText('codemirror');
    ytext.insert(0, 'Hello World');

    const remoteClient = makeClient(20, 'Remote User');
    const anchor = Y.createRelativePositionFromTypeIndex(ytext, 2);
    const head = Y.createRelativePositionFromTypeIndex(ytext, 6);

    awareness.setRemoteClientState(20, {
      editors: remoteClient,
      cursor: { anchor, head },
    });

    const remoteState = awareness.getStates().get(20);
    expect(remoteState?.editors).toEqual(remoteClient);
    expect(remoteState?.cursor?.anchor).toBeDefined();
    expect(remoteState?.cursor?.head).toBeDefined();

    // Verify that positions can be reconstructed (widget would use this)
    const restoredAnchor = Y.createAbsolutePositionFromRelativePosition(
      remoteState?.cursor?.anchor,
      ydoc,
    );
    const restoredHead = Y.createAbsolutePositionFromRelativePosition(
      remoteState?.cursor?.head,
      ydoc,
    );
    expect(restoredAnchor?.index).toBe(2);
    expect(restoredHead?.index).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Task 10.1 — Viewport classification (off-screen exclusion)
// ---------------------------------------------------------------------------

describe('Task 10.1 — Remote cursors outside the viewport are excluded from widget decorations', () => {
  it('does not create widget decorations for a cursor positioned beyond the viewport', () => {
    const ydoc = new Y.Doc({ guid: 'viewport-test' });
    const ytext = ydoc.getText('codemirror');
    // Insert enough content so the remote cursor can be outside the viewport
    const longContent = 'Line\n'.repeat(200);
    ytext.insert(0, longContent);

    const awareness = new FakeAwareness(ydoc);

    const state = EditorState.create({
      doc: longContent,
      extensions: [yCollab(ytext, null), yRichCursors(awareness as never)],
    });

    // Create a view with a small height so the viewport is limited
    const container = document.createElement('div');
    container.style.height = '100px';
    container.style.overflow = 'auto';
    document.body.appendChild(container);

    const view = new EditorView({ state, parent: container });

    // Set a remote client with cursor at a far-away position (end of doc)
    const farIndex = longContent.length - 10;
    const anchor = Y.createRelativePositionFromTypeIndex(ytext, farIndex);
    const head = Y.createRelativePositionFromTypeIndex(ytext, farIndex);
    const remoteClient = makeClient(999, 'FarUser');

    awareness.setRemoteClientState(999, {
      editors: remoteClient,
      cursor: { anchor, head },
    });

    // Force a view update cycle
    view.dispatch({});

    // Check that no cm-yRichCaret widget is rendered in the visible content
    const carets = view.dom.querySelectorAll('.cm-yRichCaret');
    expect(carets.length).toBe(0);

    view.destroy();
    container.remove();
  });
});

// ---------------------------------------------------------------------------
// Task 10.2 — Activity tracking timer lifecycle
// ---------------------------------------------------------------------------

describe('Task 10.2 — Activity tracking timer lifecycle with fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a remote client as active after awareness change, then inactive after 3s', () => {
    const ydoc = new Y.Doc({ guid: 'activity-test' });
    const ytext = ydoc.getText('codemirror');
    ytext.insert(0, 'Hello World');

    const awareness = new FakeAwareness(ydoc);

    const state = EditorState.create({
      doc: 'Hello World',
      extensions: [yCollab(ytext, null), yRichCursors(awareness as never)],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    // Set a remote client with cursor in viewport
    const anchor = Y.createRelativePositionFromTypeIndex(ytext, 0);
    const head = Y.createRelativePositionFromTypeIndex(ytext, 3);
    const remoteClient = makeClient(50, 'ActiveUser');

    awareness.setRemoteClientState(50, {
      editors: remoteClient,
      cursor: { anchor, head },
    });

    // Force update
    view.dispatch({});

    // The widget should have the active class (just changed)
    let carets = view.dom.querySelectorAll(
      '.cm-yRichCursorFlag.cm-yRichCursorActive',
    );
    expect(carets.length).toBe(1);

    // Advance 3 seconds — timer fires, triggering a decoration rebuild
    vi.advanceTimersByTime(3000);

    // After the timer dispatch, the widget should lose the active class
    carets = view.dom.querySelectorAll(
      '.cm-yRichCursorFlag.cm-yRichCursorActive',
    );
    expect(carets.length).toBe(0);

    // A new awareness change should re-activate
    awareness.setRemoteClientState(50, {
      editors: remoteClient,
      cursor: {
        anchor: Y.createRelativePositionFromTypeIndex(ytext, 1),
        head: Y.createRelativePositionFromTypeIndex(ytext, 5),
      },
    });
    view.dispatch({});

    carets = view.dom.querySelectorAll(
      '.cm-yRichCursorFlag.cm-yRichCursorActive',
    );
    expect(carets.length).toBe(1);

    view.destroy();
    container.remove();
  });
});
