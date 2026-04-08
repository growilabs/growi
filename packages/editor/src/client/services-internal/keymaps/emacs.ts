import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

// Toggle markdown symbols around the current selection.
// If the selection is already wrapped with the symbols, remove them (toggle off).
const toggleMarkdownSymbol = (
  view: EditorView,
  prefix: string,
  suffix: string,
): void => {
  const { from, to, head } = view.state.selection.main;
  const selectedText = view.state.sliceDoc(from, to);

  let insertText: string;
  if (selectedText.startsWith(prefix) && selectedText.endsWith(suffix)) {
    insertText = selectedText.slice(prefix.length, -suffix.length || undefined);
  } else {
    insertText = prefix + selectedText + suffix;
  }

  const selection =
    from === to
      ? { anchor: from + prefix.length }
      : { anchor: from, head: from + insertText.length };

  const transaction = view.state.replaceSelection(insertText);
  if (head == null) return;
  view.dispatch(transaction);
  view.dispatch({ selection });
  view.focus();
};

// Register Emacs markdown-mode style commands and keybindings.
// Uses EmacsHandler.bindKey for 3-stroke key chains (C-c C-s <key>)
// which are processed natively by the emacs plugin's key chain mechanism.
const registerMarkdownModeBindings = (
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

  // Keybindings following Emacs markdown-mode conventions:
  //   C-c C-s b / C-c C-s B  → Bold
  //   C-c C-s i / C-c C-s I  → Italic
  //   C-c C-s c              → Code (inline)
  //   C-c C-s s              → Strikethrough
  //   C-c C-s p              → Pre (code block)
  EmacsHandler.bindKey('C-c C-s b|C-c C-s S-b', 'markdownBold');
  EmacsHandler.bindKey('C-c C-s i|C-c C-s S-i', 'markdownItalic');
  EmacsHandler.bindKey('C-c C-s c', 'markdownCode');
  EmacsHandler.bindKey('C-c C-s s', 'markdownStrikethrough');
  EmacsHandler.bindKey('C-c C-s p', 'markdownCodeBlock');
};

export const emacsKeymap = async (): Promise<Extension> => {
  const { EmacsHandler, emacs } = await import('@replit/codemirror-emacs');
  registerMarkdownModeBindings(EmacsHandler);
  return emacs();
};
