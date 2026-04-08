import { Annotation, RangeSet } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, type EditorView } from '@codemirror/view';
import { ySyncFacet } from 'y-codemirror.next';
import type { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import type { EditingClient } from '../../../../interfaces';
import { createOffScreenIndicator } from './off-screen-indicator';
import { RichCaretWidget } from './widget';

type Awareness = WebsocketProvider['awareness'];

type AwarenessState = {
  editors?: EditingClient;
  cursor?: {
    anchor: Y.RelativePosition;
    head: Y.RelativePosition;
  };
};

export const yRichCursorsAnnotation = Annotation.define<number[]>();

export class YRichCursorsPluginValue {
  decorations: DecorationSet;
  private readonly awareness: Awareness;
  private readonly changeListener: (update: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => void;

  private readonly lastActivityMap: Map<number, number> = new Map();
  private readonly activeTimers: Map<number, ReturnType<typeof setTimeout>> =
    new Map();
  private readonly topContainer: HTMLElement;
  private readonly bottomContainer: HTMLElement;

  constructor(
    private readonly view: EditorView,
    awareness: Awareness,
  ) {
    this.awareness = awareness;
    this.decorations = RangeSet.of([]);

    // Create off-screen containers
    this.topContainer = document.createElement('div');
    this.topContainer.className = 'cm-offScreenTop';
    this.bottomContainer = document.createElement('div');
    this.bottomContainer.className = 'cm-offScreenBottom';
    view.dom.appendChild(this.topContainer);
    view.dom.appendChild(this.bottomContainer);

    this.changeListener = ({ added, updated, removed }) => {
      const clients = added.concat(updated).concat(removed);
      const remoteClients = clients.filter(
        (id) => id !== awareness.doc.clientID,
      );
      if (remoteClients.length > 0) {
        // Update activity timestamps for remote clients
        const now = Date.now();
        for (const clientId of remoteClients) {
          // Only track activity for added/updated (not removed)
          if (!removed.includes(clientId)) {
            this.lastActivityMap.set(clientId, now);

            // Reset the inactivity timer
            const existing = this.activeTimers.get(clientId);
            if (existing != null) clearTimeout(existing);

            this.activeTimers.set(
              clientId,
              setTimeout(() => {
                view.dispatch({
                  annotations: [yRichCursorsAnnotation.of([])],
                });
              }, 3000),
            );
          } else {
            // Clean up removed clients
            this.lastActivityMap.delete(clientId);
            const timer = this.activeTimers.get(clientId);
            if (timer != null) clearTimeout(timer);
            this.activeTimers.delete(clientId);
          }
        }

        view.dispatch({
          annotations: [yRichCursorsAnnotation.of([])],
        });
      }
    };
    this.awareness.on('change', this.changeListener);
  }

  destroy(): void {
    this.awareness.off('change', this.changeListener);
    // Clear all timers
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.lastActivityMap.clear();
    // Remove off-screen containers
    this.topContainer.remove();
    this.bottomContainer.remove();
  }

  update(viewUpdate: ViewUpdate): void {
    const conf = viewUpdate.state.facet(ySyncFacet);
    const ytext = conf?.ytext;
    const ydoc = ytext?.doc as Y.Doc | undefined;

    // Broadcast local cursor position
    const localState = this.awareness.getLocalState() as AwarenessState | null;
    if (localState != null && ytext != null) {
      const hasFocus =
        viewUpdate.view.hasFocus &&
        viewUpdate.view.dom.ownerDocument.hasFocus();
      const sel = hasFocus ? viewUpdate.state.selection.main : null;

      if (sel != null) {
        const anchor = Y.createRelativePositionFromTypeIndex(ytext, sel.anchor);
        const head = Y.createRelativePositionFromTypeIndex(ytext, sel.head);

        const currentAnchor =
          localState.cursor?.anchor != null
            ? Y.createRelativePositionFromJSON(localState.cursor.anchor)
            : null;
        const currentHead =
          localState.cursor?.head != null
            ? Y.createRelativePositionFromJSON(localState.cursor.head)
            : null;

        if (
          localState.cursor == null ||
          !Y.compareRelativePositions(currentAnchor, anchor) ||
          !Y.compareRelativePositions(currentHead, head)
        ) {
          this.awareness.setLocalStateField('cursor', { anchor, head });
        }
      } else if (localState.cursor != null && hasFocus) {
        this.awareness.setLocalStateField('cursor', null);
      }
    }

    // Rebuild remote cursor decorations
    if (ytext == null || ydoc == null) {
      this.decorations = RangeSet.of([]);
      this.topContainer.replaceChildren();
      this.bottomContainer.replaceChildren();
      return;
    }

    const decorations: { from: number; to: number; value: Decoration }[] = [];
    const aboveIndicators: HTMLElement[] = [];
    const belowIndicators: HTMLElement[] = [];
    const localClientId = this.awareness.doc.clientID;
    const { from: vpFrom, to: vpTo } = viewUpdate.view.viewport;
    const now = Date.now();

    this.awareness.getStates().forEach((rawState, clientId) => {
      if (clientId === localClientId) return;

      const state = rawState as AwarenessState;
      const editors = state.editors;
      const cursor = state.cursor;

      if (editors == null || cursor?.anchor == null || cursor?.head == null) {
        return;
      }

      const anchor = Y.createAbsolutePositionFromRelativePosition(
        cursor.anchor,
        ydoc,
      );
      const head = Y.createAbsolutePositionFromRelativePosition(
        cursor.head,
        ydoc,
      );

      if (
        anchor == null ||
        head == null ||
        anchor.type !== ytext ||
        head.type !== ytext
      ) {
        return;
      }

      const isActive = now - (this.lastActivityMap.get(clientId) ?? 0) < 3000;
      const headIndex = head.index;

      // Classify: in-viewport or off-screen
      if (headIndex < vpFrom) {
        aboveIndicators.push(
          createOffScreenIndicator({
            direction: 'above',
            color: editors.color,
            name: editors.name,
            imageUrlCached: editors.imageUrlCached,
            isActive,
          }),
        );
        return;
      }
      if (headIndex > vpTo) {
        belowIndicators.push(
          createOffScreenIndicator({
            direction: 'below',
            color: editors.color,
            name: editors.name,
            imageUrlCached: editors.imageUrlCached,
            isActive,
          }),
        );
        return;
      }

      // In-viewport: render decorations
      const start = Math.min(anchor.index, head.index);
      const end = Math.max(anchor.index, head.index);

      if (start !== end) {
        decorations.push({
          from: start,
          to: end,
          value: Decoration.mark({
            attributes: { style: `background-color: ${editors.colorLight}` },
            class: 'cm-ySelection',
          }),
        });
      }

      decorations.push({
        from: headIndex,
        to: headIndex,
        value: Decoration.widget({
          side: headIndex - anchor.index > 0 ? -1 : 1,
          block: false,
          widget: new RichCaretWidget({
            color: editors.color,
            name: editors.name,
            imageUrlCached: editors.imageUrlCached,
            isActive,
          }),
        }),
      });
    });

    this.decorations = Decoration.set(decorations, true);
    this.topContainer.replaceChildren(...aboveIndicators);
    this.bottomContainer.replaceChildren(...belowIndicators);
  }
}
