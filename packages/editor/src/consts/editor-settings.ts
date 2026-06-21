import type { EditorTheme } from './editor-themes';
import type { KeyMapMode } from './keymaps';
import type { PasteMode } from './paste-mode';

export interface EditorSettings {
  theme: undefined | EditorTheme;
  keymapMode: undefined | KeyMapMode;
  pasteMode: undefined | PasteMode;
  styleActiveLine: boolean;
  autoFormatMarkdownTable: boolean;
}
