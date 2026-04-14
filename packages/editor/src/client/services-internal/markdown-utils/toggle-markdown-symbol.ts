import type { EditorView } from '@codemirror/view';

/**
 * Toggle markdown symbols around the current selection.
 * If the selection is already wrapped with prefix/suffix, remove them.
 * If no text is selected, insert prefix+suffix and position cursor between them.
 */
export const toggleMarkdownSymbol = (
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
