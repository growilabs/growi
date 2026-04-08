import type { Extension } from '@codemirror/state';
import { Annotation, RangeSet } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import { ySyncFacet } from 'y-codemirror.next';
import type { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

type Awareness = WebsocketProvider['awareness'];

import type { EditingClient } from '../../../interfaces';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derives initials (up to 2 letters) from a display name. */
function toInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return (words[0][0] ?? '').toUpperCase();
  return (
    (words[0][0] ?? '') + (words[words.length - 1][0] ?? '')
  ).toUpperCase();
}

// ---------------------------------------------------------------------------
// RichCaretWidget
// ---------------------------------------------------------------------------

/**
 * CodeMirror WidgetType that renders a cursor caret with an overlay flag
 * containing avatar image (or initials fallback) and hover-revealed name label.
 *
 * DOM structure:
 * <span class="cm-yRichCaret" style="border-color: {color}">
 *   <span class="cm-yRichCursorFlag [cm-yRichCursorActive]">
 *     <img class="cm-yRichCursorAvatar" />  OR  <span class="cm-yRichCursorInitials" />
 *     <span class="cm-yRichCursorInfo" style="background-color: {color}">{name}</span>
 *   </span>
 * </span>
 */
export class RichCaretWidget extends WidgetType {
  constructor(
    readonly color: string,
    readonly name: string,
    readonly imageUrlCached: string | undefined,
    readonly isActive: boolean,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const caret = document.createElement('span');
    caret.className = 'cm-yRichCaret';
    caret.style.borderColor = this.color;

    const flag = document.createElement('span');
    flag.className = 'cm-yRichCursorFlag';
    if (this.isActive) {
      flag.classList.add('cm-yRichCursorActive');
    }

    if (this.imageUrlCached) {
      const img = document.createElement('img');
      img.className = 'cm-yRichCursorAvatar';
      img.src = this.imageUrlCached;
      img.alt = this.name;
      img.onerror = () => {
        const initials = createInitialsElement(this.name, this.color);
        img.replaceWith(initials);
      };
      flag.appendChild(img);
    } else {
      flag.appendChild(createInitialsElement(this.name, this.color));
    }

    const info = document.createElement('span');
    info.className = 'cm-yRichCursorInfo';
    info.style.backgroundColor = this.color;
    info.textContent = this.name;
    flag.appendChild(info);

    caret.appendChild(flag);
    return caret;
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof RichCaretWidget)) return false;
    return (
      other.color === this.color &&
      other.name === this.name &&
      other.imageUrlCached === this.imageUrlCached &&
      other.isActive === this.isActive
    );
  }

  get estimatedHeight(): number {
    return -1;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Off-Screen Indicator
// ---------------------------------------------------------------------------

function createInitialsElement(name: string, color: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'cm-yRichCursorInitials';
  el.style.backgroundColor = color;
  el.textContent = toInitials(name);
  return el;
}

type OffScreenIndicatorOptions = {
  direction: 'above' | 'below';
  color: string;
  name: string;
  imageUrlCached: string | undefined;
  isActive: boolean;
};

/**
 * Creates an off-screen indicator DOM element for a remote cursor
 * that is outside the visible viewport.
 */
export function createOffScreenIndicator(
  opts: OffScreenIndicatorOptions,
): HTMLElement {
  const { direction, color, name, imageUrlCached, isActive } = opts;

  const indicator = document.createElement('span');
  indicator.className = 'cm-offScreenIndicator';
  indicator.style.borderColor = color;
  if (isActive) {
    indicator.classList.add('cm-yRichCursorActive');
  }

  const arrow = document.createElement('span');
  arrow.className = 'cm-offScreenArrow';
  arrow.textContent = direction === 'above' ? '↑' : '↓';
  indicator.appendChild(arrow);

  if (imageUrlCached) {
    const img = document.createElement('img');
    img.className = 'cm-offScreenAvatar';
    img.src = imageUrlCached;
    img.alt = name;
    img.onerror = () => {
      const initials = document.createElement('span');
      initials.className = 'cm-offScreenInitials';
      initials.style.backgroundColor = color;
      initials.textContent = toInitials(name);
      img.replaceWith(initials);
    };
    indicator.appendChild(img);
  } else {
    const initials = document.createElement('span');
    initials.className = 'cm-offScreenInitials';
    initials.style.backgroundColor = color;
    initials.textContent = toInitials(name);
    indicator.appendChild(initials);
  }

  return indicator;
}

// ---------------------------------------------------------------------------
// yRichCursors ViewPlugin
// ---------------------------------------------------------------------------

type AwarenessState = {
  editors?: EditingClient;
  cursor?: {
    anchor: Y.RelativePosition;
    head: Y.RelativePosition;
  };
};

const yRichCursorsAnnotation = Annotation.define<number[]>();

class YRichCursorsPluginValue {
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
          widget: new RichCaretWidget(
            editors.color,
            editors.name,
            editors.imageUrlCached,
            isActive,
          ),
        }),
      });
    });

    this.decorations = Decoration.set(decorations, true);
    this.topContainer.replaceChildren(...aboveIndicators);
    this.bottomContainer.replaceChildren(...belowIndicators);
  }
}

// ---------------------------------------------------------------------------
// baseTheme
// ---------------------------------------------------------------------------

const richCursorsTheme = EditorView.baseTheme({
  // Caret line
  '.cm-yRichCaret': {
    position: 'relative',
    borderLeft: '2px solid',
  },

  // Overlay flag — positioned below the caret
  '.cm-yRichCursorFlag': {
    position: 'absolute',
    top: '100%',
    left: '-8px',
    zIndex: '10',
    pointerEvents: 'none',
    opacity: '0.4',
    transition: 'opacity 0.3s ease',
  },
  '.cm-yRichCaret:hover .cm-yRichCursorFlag': {
    pointerEvents: 'auto',
    opacity: '1',
  },
  '.cm-yRichCursorFlag.cm-yRichCursorActive': {
    opacity: '1',
  },

  // Avatar image
  '.cm-yRichCursorAvatar': {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'block',
  },

  // Initials fallback
  '.cm-yRichCursorInitials': {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: '8px',
    fontWeight: 'bold',
  },

  // Name label — hidden by default, shown on hover
  '.cm-yRichCursorInfo': {
    display: 'none',
    position: 'absolute',
    top: '0',
    left: '20px',
    whiteSpace: 'nowrap',
    padding: '2px 6px',
    borderRadius: '3px',
    color: 'white',
    fontSize: '12px',
    lineHeight: '16px',
  },
  '.cm-yRichCursorFlag:hover .cm-yRichCursorInfo': {
    display: 'block',
  },

  // --- Off-screen containers ---
  '.cm-offScreenTop, .cm-offScreenBottom': {
    position: 'absolute',
    left: '0',
    right: '0',
    display: 'flex',
    gap: '4px',
    padding: '2px 4px',
    pointerEvents: 'none',
    zIndex: '10',
  },
  '.cm-offScreenTop': {
    top: '0',
  },
  '.cm-offScreenBottom': {
    bottom: '0',
  },

  // Off-screen indicator
  '.cm-offScreenIndicator': {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    opacity: '0.4',
    transition: 'opacity 0.3s ease',
  },
  '.cm-offScreenIndicator.cm-yRichCursorActive': {
    opacity: '1',
  },
  '.cm-offScreenArrow': {
    fontSize: '10px',
    lineHeight: '1',
  },
  '.cm-offScreenAvatar': {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
  },
  '.cm-offScreenInitials': {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: '8px',
    fontWeight: 'bold',
  },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a CodeMirror Extension that renders remote user cursors with
 * name labels and avatar images, reading user data from state.editors.
 *
 * Also broadcasts the local user's cursor position via state.cursor.
 */
export function yRichCursors(awareness: Awareness): Extension {
  return [
    ViewPlugin.define((view) => new YRichCursorsPluginValue(view, awareness), {
      decorations: (v) => (v as YRichCursorsPluginValue).decorations,
    }),
    richCursorsTheme,
  ];
}
