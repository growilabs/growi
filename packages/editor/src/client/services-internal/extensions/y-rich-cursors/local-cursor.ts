import type { ViewUpdate } from '@codemirror/view';
import type { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

type Awareness = WebsocketProvider['awareness'];

type LocalCursorState = {
  cursor?: {
    anchor: Y.RelativePosition;
    head: Y.RelativePosition;
  };
};

/**
 * Broadcasts the local user's cursor position to the Yjs awareness protocol.
 *
 * Compares the current selection with the stored awareness cursor to avoid
 * redundant broadcasts. Clears the cursor field when the editor loses focus.
 */
export function broadcastLocalCursor(
  viewUpdate: ViewUpdate,
  awareness: Awareness,
  ytext: Y.Text,
): void {
  const localState = awareness.getLocalState() as LocalCursorState | null;
  if (localState == null) return;

  const hasFocus =
    viewUpdate.view.hasFocus && viewUpdate.view.dom.ownerDocument.hasFocus();
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
      awareness.setLocalStateField('cursor', { anchor, head });
    }
  } else if (localState.cursor != null && hasFocus) {
    awareness.setLocalStateField('cursor', null);
  }
}
