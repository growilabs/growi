import type { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { WebsocketProvider } from 'y-websocket';

import { YRichCursorsPluginValue } from './plugin';
import { richCursorsTheme } from './theme';

export type { OffScreenIndicatorOptions } from './off-screen-indicator';
export { createOffScreenIndicator } from './off-screen-indicator';
export { RichCaretWidget } from './widget';

type Awareness = WebsocketProvider['awareness'];

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
