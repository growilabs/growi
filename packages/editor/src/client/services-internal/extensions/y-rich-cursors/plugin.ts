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

  constructor(view: EditorView, awareness: Awareness) {
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
    type IndicatorEntry = { el: HTMLElement; headIndex: number };
    const aboveIndicators: IndicatorEntry[] = [];
    const belowIndicators: IndicatorEntry[] = [];
    const localClientId = this.awareness.doc.clientID;

    const visibleRanges = viewUpdate.view.visibleRanges;
    const { from: viewportFrom, to: viewportTo } = viewUpdate.view.viewport;

    // Three classification strategies (chosen once per update call):
    //
    // "ranged": visibleRanges is a true sub-range of viewport — CodeMirror's own
    //   scroller is active (e.g. fixed-height editor in tests). Use character-
    //   position bounds derived from visibleRanges.
    //
    // "coords": visibleRanges == viewport — the editor expands to full content
    //   height and the *page* handles scrolling (GROWI's production setup). Use
    //   the cursor's actual screen coordinates vs the editor's visible rect
    //   (scrollDOM.getBoundingClientRect clamped to window.innerHeight).
    //
    // "none" (degenerate — jsdom with 0-height container): scrollRect.height == 0
    //   so screen coordinates are unreliable. Skip all off-screen classification
    //   and give every cursor a widget decoration, matching pre-task-12 behaviour.
    const hasVisibleRanges = visibleRanges.length > 0;
    // rangedMode: visibleRanges is a meaningful sub-range of viewport.
    // Requires the visible area to be non-empty (to > from) so that a 0-height
    // editor (jsdom degenerate) doesn't accidentally classify every cursor as
    // off-screen via a vpTo of 0.
    const rangedMode =
      hasVisibleRanges &&
      visibleRanges[visibleRanges.length - 1].to > visibleRanges[0].from &&
      (visibleRanges[0].from > viewportFrom ||
        visibleRanges[visibleRanges.length - 1].to < viewportTo);

    // For coords mode: compute visible band once before the per-cursor loop.
    // getBoundingClientRect() is a raw DOM call (not a CodeMirror layout read)
    // so it is allowed during update(). lineBlockAt() uses the stored height map
    // and is also safe during update().
    // When scrollDOMRect.height == 0 (jsdom), screenVisibleBottom == 0 so the
    // below/above checks never fire and every cursor falls through to a widget.
    let scrollDOMTop = 0;
    let scrollDOMBottom = 0;
    let scrollTop = 0;
    if (!rangedMode) {
      const scrollDOMRect = viewUpdate.view.scrollDOM.getBoundingClientRect();
      scrollDOMTop = scrollDOMRect.top;
      scrollDOMBottom = scrollDOMRect.bottom;
      scrollTop = viewUpdate.view.scrollDOM.scrollTop;
    }
    const screenVisibleTop = Math.max(scrollDOMTop, 0);
    const screenVisibleBottom = Math.min(scrollDOMBottom, window.innerHeight);

    const vpFrom = hasVisibleRanges ? visibleRanges[0].from : viewportFrom;
    const vpTo = hasVisibleRanges
      ? visibleRanges[visibleRanges.length - 1].to
      : viewportTo;

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

      // Classify: off-screen (above/below) or in-viewport
      if (rangedMode) {
        if (headIndex < vpFrom) {
          aboveIndicators.push({
            el: createOffScreenIndicator({
              direction: 'above',
              color: editors.color,
              name: editors.name,
              imageUrlCached: editors.imageUrlCached,
              isActive,
            }),
            headIndex,
          });
          return;
        }
        if (headIndex > vpTo) {
          belowIndicators.push({
            el: createOffScreenIndicator({
              direction: 'below',
              color: editors.color,
              name: editors.name,
              imageUrlCached: editors.imageUrlCached,
              isActive,
            }),
            headIndex,
          });
          return;
        }
      } else {
        // coords mode: compare screen Y of cursor against the editor's visible rect.
        // Used when visibleRanges == viewport (page-scroll editor, e.g. GROWI).
        //
        // lineBlockAt() reads stored heights (safe during update).
        // When scrollDOMRect.height == 0 (jsdom) both checks below are false
        // so every cursor falls through to a widget decoration.
        const lineBlock = viewUpdate.view.lineBlockAt(headIndex);
        const cursorTop = scrollDOMTop + lineBlock.top - scrollTop;
        const cursorBottom = scrollDOMTop + lineBlock.bottom - scrollTop;

        if (cursorBottom < screenVisibleTop) {
          aboveIndicators.push({
            el: createOffScreenIndicator({
              direction: 'above',
              color: editors.color,
              name: editors.name,
              imageUrlCached: editors.imageUrlCached,
              isActive,
            }),
            headIndex,
          });
          return;
        }
        if (cursorTop > screenVisibleBottom) {
          belowIndicators.push({
            el: createOffScreenIndicator({
              direction: 'below',
              color: editors.color,
              name: editors.name,
              imageUrlCached: editors.imageUrlCached,
              isActive,
            }),
            headIndex,
          });
          return;
        }
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
    this.topContainer.replaceChildren(...aboveIndicators.map(({ el }) => el));
    this.bottomContainer.replaceChildren(
      ...belowIndicators.map(({ el }) => el),
    );

    // Position each indicator horizontally at the remote cursor's column.
    // coordsAtPos reads layout so it must be deferred to the measure phase.
    const allIndicators = [...aboveIndicators, ...belowIndicators];
    if (allIndicators.length > 0) {
      viewUpdate.view.requestMeasure({
        read: (view) => {
          const editorLeft = view.dom.getBoundingClientRect().left;
          return allIndicators.map(({ headIndex: hi }) => {
            const coords = view.coordsAtPos(hi, 1);
            if (coords != null) {
              return coords.left - editorLeft;
            }
            // Fallback for virtualised positions (outside CodeMirror's viewport)
            const line = view.state.doc.lineAt(hi);
            const col = hi - line.from;
            const contentLeft =
              view.contentDOM.getBoundingClientRect().left - editorLeft;
            return contentLeft + col * view.defaultCharacterWidth;
          });
        },
        write: (positions) => {
          allIndicators.forEach(({ el }, i) => {
            el.style.left = `${positions[i]}px`;
            el.style.transform = 'translateX(-50%)';
          });
        },
      });
    }
  }
}
