import { Annotation, RangeSet } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, type EditorView } from '@codemirror/view';
import { ySyncFacet } from 'y-codemirror.next';
import type { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import type { EditingClient } from '../../../../interfaces';
import { ActivityTracker } from './activity-tracker';
import { createOffScreenIndicator, RichCaretWidget } from './dom';
import { broadcastLocalCursor } from './local-cursor';
import {
  classifyCursorPosition,
  createViewportContext,
} from './viewport-classification';

type Awareness = WebsocketProvider['awareness'];

type AwarenessState = {
  editors?: EditingClient;
  cursor?: {
    anchor: Y.RelativePosition;
    head: Y.RelativePosition;
  };
};

type IndicatorEntry = { el: HTMLElement; headIndex: number };

/** Mutable ref container for the scroll-to-remote-cursor function. */
export type ScrollCallbackRef = {
  current: ((clientId: number) => void) | null;
};

export const yRichCursorsAnnotation = Annotation.define<number[]>();

export class YRichCursorsPluginValue {
  decorations: DecorationSet;
  private readonly awareness: Awareness;
  private readonly scrollCallbackRef: ScrollCallbackRef | undefined;
  private readonly activityTracker = new ActivityTracker();
  private readonly changeListener: (update: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => void;
  private readonly topContainer: HTMLElement;
  private readonly bottomContainer: HTMLElement;

  constructor(
    view: EditorView,
    awareness: Awareness,
    scrollCallbackRef?: ScrollCallbackRef,
  ) {
    this.awareness = awareness;
    this.scrollCallbackRef = scrollCallbackRef;
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
      if (remoteClients.length === 0) return;

      const now = Date.now();
      for (const clientId of remoteClients) {
        if (!removed.includes(clientId)) {
          this.activityTracker.recordActivity(clientId, now, () => {
            view.dispatch({
              annotations: [yRichCursorsAnnotation.of([])],
            });
          });
        } else {
          this.activityTracker.removeClient(clientId);
        }
      }

      view.dispatch({
        annotations: [yRichCursorsAnnotation.of([])],
      });
    };
    this.awareness.on('change', this.changeListener);
  }

  destroy(): void {
    this.awareness.off('change', this.changeListener);
    this.activityTracker.destroy();
    this.topContainer.remove();
    this.bottomContainer.remove();
  }

  update(viewUpdate: ViewUpdate): void {
    const conf = viewUpdate.state.facet(ySyncFacet);
    const ytext = conf?.ytext;
    const ydoc = ytext?.doc as Y.Doc | undefined;

    // Broadcast local cursor position
    if (ytext != null) {
      broadcastLocalCursor(viewUpdate, this.awareness, ytext);
    }

    // Rebuild remote cursor decorations
    if (ytext == null || ydoc == null) {
      this.decorations = RangeSet.of([]);
      this.topContainer.replaceChildren();
      this.bottomContainer.replaceChildren();
      return;
    }

    const { decorations, aboveIndicators, belowIndicators } =
      this.buildRemoteCursors(viewUpdate, ytext, ydoc);

    this.decorations = Decoration.set(decorations, true);
    this.topContainer.replaceChildren(...aboveIndicators.map(({ el }) => el));
    this.bottomContainer.replaceChildren(
      ...belowIndicators.map(({ el }) => el),
    );

    this.positionIndicatorsHorizontally(viewUpdate, [
      ...aboveIndicators,
      ...belowIndicators,
    ]);
  }

  /** Iterates remote awareness states and builds decorations / off-screen indicators. */
  private buildRemoteCursors(
    viewUpdate: ViewUpdate,
    ytext: Y.Text,
    ydoc: Y.Doc,
  ): {
    decorations: { from: number; to: number; value: Decoration }[];
    aboveIndicators: IndicatorEntry[];
    belowIndicators: IndicatorEntry[];
  } {
    const decorations: { from: number; to: number; value: Decoration }[] = [];
    const aboveIndicators: IndicatorEntry[] = [];
    const belowIndicators: IndicatorEntry[] = [];
    const localClientId = this.awareness.doc.clientID;
    const ctx = createViewportContext(viewUpdate.view);
    const now = Date.now();

    // Build the click handler once (reads ref.current lazily at call time)
    const onClickIndicator =
      this.scrollCallbackRef != null
        ? (id: number) => this.scrollCallbackRef?.current?.(id)
        : undefined;

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

      const headIndex = head.index;
      const isActive = this.activityTracker.isActive(clientId, now);
      const classification = classifyCursorPosition(
        ctx,
        viewUpdate.view,
        headIndex,
      );

      if (classification !== 'in-viewport') {
        const target =
          classification === 'above' ? aboveIndicators : belowIndicators;
        target.push({
          el: createOffScreenIndicator({
            direction: classification,
            clientId,
            color: editors.color,
            name: editors.name,
            imageUrlCached: editors.imageUrlCached,
            isActive,
            onClick: onClickIndicator,
          }),
          headIndex,
        });
        return;
      }

      // In-viewport: render decorations
      const start = Math.min(anchor.index, headIndex);
      const end = Math.max(anchor.index, headIndex);

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

    return { decorations, aboveIndicators, belowIndicators };
  }

  /** Defers horizontal positioning to CodeMirror's measure phase. */
  private positionIndicatorsHorizontally(
    viewUpdate: ViewUpdate,
    indicators: IndicatorEntry[],
  ): void {
    if (indicators.length === 0) return;

    viewUpdate.view.requestMeasure({
      read: (view) => {
        const editorLeft = view.dom.getBoundingClientRect().left;
        return indicators.map(({ headIndex }) => {
          const coords = view.coordsAtPos(headIndex, 1);
          if (coords != null) {
            return coords.left - editorLeft;
          }
          // Fallback for virtualised positions (outside CodeMirror's viewport)
          const line = view.state.doc.lineAt(headIndex);
          const col = headIndex - line.from;
          const contentLeft =
            view.contentDOM.getBoundingClientRect().left - editorLeft;
          return contentLeft + col * view.defaultCharacterWidth;
        });
      },
      write: (positions) => {
        indicators.forEach(({ el }, i) => {
          el.style.left = `${positions[i]}px`;
          el.style.transform = 'translateX(-50%)';
        });
      },
    });
  }
}
