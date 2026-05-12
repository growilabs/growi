import type { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { WebsocketProvider } from 'y-websocket';

import { richCursorsTheme } from './dom';
import type { ScrollCallbackRef } from './plugin';
import { YRichCursorsPluginValue } from './plugin';

type Awareness = WebsocketProvider['awareness'];

/** Options for the yRichCursors extension. */
export type YRichCursorsOptions = {
  /**
   * Mutable ref holding the scroll-to-remote-cursor callback.
   * When set, off-screen indicator clicks invoke ref.current(clientId).
   * Null or unset means clicks are no-ops.
   */
  onClickIndicator?: ScrollCallbackRef;
};

/**
 * Creates a CodeMirror Extension that renders remote user cursors with
 * name labels and avatar images, reading user data from state.editors.
 *
 * Also broadcasts the local user's cursor position via state.cursor.
 * Renders clickable off-screen indicators for cursors outside the viewport.
 */
export function yRichCursors(
  awareness: Awareness,
  options?: YRichCursorsOptions,
): Extension {
  return [
    ViewPlugin.define(
      (view) =>
        new YRichCursorsPluginValue(view, awareness, options?.onClickIndicator),
      {
        decorations: (v) => (v as YRichCursorsPluginValue).decorations,
      },
    ),
    richCursorsTheme,
  ];
}
