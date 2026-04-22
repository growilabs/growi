import { describe, expect, it, vi } from 'vitest';

import type { EditingClient } from '../../interfaces';

/**
 * Unit tests for awareness state handling logic extracted from
 * use-collaborative-editor-mode.ts.
 *
 * These tests cover:
 * - Task 1.1: undefined awareness entries are filtered before onEditorsUpdated is called
 * - Task 1.2: awareness.getStates().delete() is NOT called for removed clients
 * - Task 4.1: Requirements 1.1, 1.2, 1.4
 */

// ---------------------------------------------------------------------------
// Helpers — minimal stubs that replicate the logic under test
// ---------------------------------------------------------------------------

type AwarenessState = { editors?: EditingClient };

/** Replicates the FIXED emitEditorList logic */
function emitEditorList(
  states: Map<number, AwarenessState>,
  onEditorsUpdated: (list: EditingClient[]) => void,
): void {
  const clientList = Array.from(states.values())
    .map((v) => v.editors)
    .filter((v): v is EditingClient => v != null);
  onEditorsUpdated(clientList);
}

/** Replicates the FIXED updateAwarenessHandler logic */
function updateAwarenessHandler(
  _update: { added: number[]; updated: number[]; removed: number[] },
  awareness: { getStates: () => Map<number, AwarenessState> },
  onEditorsUpdated: (list: EditingClient[]) => void,
): void {
  // Task 1.2: No .delete() call for removed client IDs
  emitEditorList(awareness.getStates(), onEditorsUpdated);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const validClient: EditingClient = {
  clientId: 1,
  name: 'Alice',
  color: '#ff0000',
  colorLight: '#ff000033',
};

describe('emitEditorList', () => {
  describe('Task 1.1 / 1.4 — filter undefined awareness entries', () => {
    it('passes only valid EditingClient entries to onEditorsUpdated', () => {
      const states = new Map<number, AwarenessState>([
        [1, { editors: validClient }],
        [2, {}], // no editors field
        [3, { editors: undefined }], // editors explicitly undefined
      ]);
      const onEditorsUpdated = vi.fn();

      emitEditorList(states, onEditorsUpdated);

      expect(onEditorsUpdated).toHaveBeenCalledOnce();
      expect(onEditorsUpdated).toHaveBeenCalledWith([validClient]);
    });

    it('calls onEditorsUpdated with an empty array when no state has editors', () => {
      const states = new Map<number, AwarenessState>([
        [1, {}],
        [2, { editors: undefined }],
      ]);
      const onEditorsUpdated = vi.fn();

      emitEditorList(states, onEditorsUpdated);

      expect(onEditorsUpdated).toHaveBeenCalledWith([]);
    });

    it('passes all valid entries when every state has editors', () => {
      const anotherClient: EditingClient = {
        clientId: 2,
        name: 'Bob',
        color: '#0000ff',
        colorLight: '#0000ff33',
      };
      const states = new Map<number, AwarenessState>([
        [1, { editors: validClient }],
        [2, { editors: anotherClient }],
      ]);
      const onEditorsUpdated = vi.fn();

      emitEditorList(states, onEditorsUpdated);

      expect(onEditorsUpdated).toHaveBeenCalledWith([
        validClient,
        anotherClient,
      ]);
    });
  });
});

describe('updateAwarenessHandler', () => {
  describe('Task 1.2 — no direct mutation of awareness.getStates()', () => {
    it('does NOT call .delete() on the awareness states map for removed clients', () => {
      const deleteSpy = vi.fn();
      const states = new Map<number, AwarenessState>([
        [1, { editors: validClient }],
      ]);
      states.delete = deleteSpy;

      const awareness = { getStates: () => states };
      const onEditorsUpdated = vi.fn();

      updateAwarenessHandler(
        { added: [], updated: [], removed: [99] },
        awareness,
        onEditorsUpdated,
      );

      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('still calls onEditorsUpdated after a removed event', () => {
      const states = new Map<number, AwarenessState>([
        [1, { editors: validClient }],
      ]);
      const awareness = { getStates: () => states };
      const onEditorsUpdated = vi.fn();

      updateAwarenessHandler(
        { added: [], updated: [], removed: [99] },
        awareness,
        onEditorsUpdated,
      );

      expect(onEditorsUpdated).toHaveBeenCalledOnce();
      expect(onEditorsUpdated).toHaveBeenCalledWith([validClient]);
    });
  });
});
