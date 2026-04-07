import type { Extension } from '@codemirror/state';
import { RangeSet } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { ySyncFacet } from 'y-codemirror.next';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import type { EditingClient } from '../../../interfaces';

// ---------------------------------------------------------------------------
// RichCaretWidget
// ---------------------------------------------------------------------------

/** Derives initials (up to 2 letters) from a display name. */
function toInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return (words[0][0] ?? '').toUpperCase();
  return (
    (words[0][0] ?? '') + (words[words.length - 1][0] ?? '')
  ).toUpperCase();
}

/**
 * CodeMirror WidgetType that renders a cursor caret with user name and avatar.
 *
 * DOM structure:
 * <span class="cm-yRichCaret" style="border-color: {color}">
 *   <img class="cm-yRichCursorAvatar" src="{imageUrlCached}" alt="{name}" />
 *   <!-- OR when no image: -->
 *   <span class="cm-yRichCursorInitials">{initials}</span>
 *   <span class="cm-yRichCursorInfo" style="background-color: {color}">{name}</span>
 * </span>
 */
export class RichCaretWidget extends WidgetType {
  constructor(
    readonly color: string,
    readonly name: string,
    readonly imageUrlCached: string | undefined,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const caret = document.createElement('span');
    caret.className = 'cm-yRichCaret';
    caret.style.borderColor = this.color;

    if (this.imageUrlCached) {
      const img = document.createElement('img');
      img.className = 'cm-yRichCursorAvatar';
      img.src = this.imageUrlCached;
      img.alt = this.name;
      img.onerror = () => {
        const initials = document.createElement('span');
        initials.className = 'cm-yRichCursorInitials';
        initials.textContent = toInitials(this.name);
        img.replaceWith(initials);
      };
      caret.appendChild(img);
    } else {
      const initials = document.createElement('span');
      initials.className = 'cm-yRichCursorInitials';
      initials.textContent = toInitials(this.name);
      caret.appendChild(initials);
    }

    const info = document.createElement('span');
    info.className = 'cm-yRichCursorInfo';
    info.style.backgroundColor = this.color;
    info.textContent = this.name;
    caret.appendChild(info);

    return caret;
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof RichCaretWidget)) return false;
    return (
      other.color === this.color &&
      other.name === this.name &&
      other.imageUrlCached === this.imageUrlCached
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
// yRichCursors ViewPlugin
// ---------------------------------------------------------------------------

type AwarenessState = {
  editors?: EditingClient;
  cursor?: {
    anchor: Y.RelativePosition;
    head: Y.RelativePosition;
  };
};

class YRichCursorsPluginValue {
  decorations: DecorationSet;
  private readonly awareness: Awareness;
  private readonly changeListener: () => void;

  constructor(
    view: Parameters<typeof ViewPlugin.fromClass>[0] extends new (
      v: infer V,
    ) => unknown
      ? V
      : never,
    awareness: Awareness,
  ) {
    this.awareness = awareness;
    this.decorations = RangeSet.of([]);

    this.changeListener = () => {
      view.dispatch({ effects: [] });
    };
    this.awareness.on('change', this.changeListener);
  }

  destroy(): void {
    this.awareness.off('change', this.changeListener);
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
      return;
    }

    const decorations: { from: number; to: number; value: Decoration }[] = [];
    const localClientId = this.awareness.doc.clientID;

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
        from: head.index,
        to: head.index,
        value: Decoration.widget({
          side: head.index - anchor.index > 0 ? -1 : 1,
          block: false,
          widget: new RichCaretWidget(
            editors.color,
            editors.name,
            editors.imageUrlCached,
          ),
        }),
      });
    });

    this.decorations = Decoration.set(decorations, true);
  }
}

/**
 * Creates a CodeMirror Extension that renders remote user cursors with
 * name labels and avatar images, reading user data from state.editors.
 *
 * Also broadcasts the local user's cursor position via state.cursor.
 */
export function yRichCursors(awareness: Awareness): Extension {
  return ViewPlugin.define(
    (view) => new YRichCursorsPluginValue(view as never, awareness),
    { decorations: (v) => (v as YRichCursorsPluginValue).decorations },
  );
}
