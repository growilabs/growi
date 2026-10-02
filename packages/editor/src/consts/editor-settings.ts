import type { EditorTheme } from './editor-themes.js';
import type { KeyMapMode } from './keymaps.js';
import type { PasteMode } from './paste-mode.js';

export interface EditorSettings {
  theme: undefined | EditorTheme;
  keymapMode: undefined | KeyMapMode;
  pasteMode: undefined | PasteMode;
  styleActiveLine: boolean;
  autoFormatMarkdownTable: boolean;
}
