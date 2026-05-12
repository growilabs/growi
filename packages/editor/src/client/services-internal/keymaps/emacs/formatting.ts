import type { EditorView } from '@codemirror/view';

import { toggleMarkdownSymbol } from '../../markdown-utils';

/**
 * Register Emacs markdown-mode formatting commands and keybindings.
 * Uses C-c C-s prefix following Emacs markdown-mode conventions.
 */
export const registerFormattingBindings = (
  EmacsHandler: typeof import('@replit/codemirror-emacs').EmacsHandler,
): void => {
  EmacsHandler.addCommands({
    markdownBold(handler: { view: EditorView }) {
      toggleMarkdownSymbol(handler.view, '**', '**');
    },
    markdownItalic(handler: { view: EditorView }) {
      toggleMarkdownSymbol(handler.view, '*', '*');
    },
    markdownCode(handler: { view: EditorView }) {
      toggleMarkdownSymbol(handler.view, '`', '`');
    },
    markdownStrikethrough(handler: { view: EditorView }) {
      toggleMarkdownSymbol(handler.view, '~~', '~~');
    },
    markdownCodeBlock(handler: { view: EditorView }) {
      toggleMarkdownSymbol(handler.view, '```\n', '\n```');
    },
  });

  // C-c C-s b / C-c C-s B → Bold
  // C-c C-s i / C-c C-s I → Italic
  // C-c C-s c → Code (inline)
  // C-c C-s s → Strikethrough
  // C-c C-s p → Pre (code block)
  EmacsHandler.bindKey('C-c C-s b|C-c C-s S-b', 'markdownBold');
  EmacsHandler.bindKey('C-c C-s i|C-c C-s S-i', 'markdownItalic');
  EmacsHandler.bindKey('C-c C-s c', 'markdownCode');
  EmacsHandler.bindKey('C-c C-s s', 'markdownStrikethrough');
  EmacsHandler.bindKey('C-c C-s p', 'markdownCodeBlock');
};
