import { useEffect } from 'react';
import type { EditorView } from '@codemirror/view';
import { type KeyBinding, keymap } from '@codemirror/view';

import type { KeyMapMode } from '../../consts';
import type { UseCodeMirrorEditor } from '../services';
import { useAddMultiCursorKeyBindings } from '../services/use-codemirror-editor/utils/editor-shortcuts/add-multi-cursor';
import { useInsertBlockquoteKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/insert-blockquote';
import { useInsertBulletListKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/insert-bullet-list';
import { useInsertLinkKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/insert-link';
import { useInsertNumberedKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/insert-numbered-list';
import { useMakeTextBoldKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/make-text-bold';
import { useMakeTextCodeKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/make-text-code';
import { useMakeCodeBlockExtension } from '../services/use-codemirror-editor/utils/editor-shortcuts/make-text-code-block';
import { useMakeTextItalicKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/make-text-italic';
import { useMakeTextStrikethroughKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/make-text-strikethrough';

const useKeyBindings = (
  view?: EditorView,
  keymapModeName?: KeyMapMode,
): KeyBinding[] => {
  // Standard formatting keybindings (used for non-emacs modes)
  const makeTextBoldKeyBinding = useMakeTextBoldKeyBinding(
    view,
    keymapModeName,
  );
  const makeTextItalicKeyBinding = useMakeTextItalicKeyBinding(view);
  const makeTextStrikethroughKeyBinding =
    useMakeTextStrikethroughKeyBinding(view);
  const makeTextCodeCommand = useMakeTextCodeKeyBinding(view);

  // Shared keybindings (no conflicts with any keymap mode)
  const insertNumberedKeyBinding = useInsertNumberedKeyBinding(view);
  const insertBulletListKeyBinding = useInsertBulletListKeyBinding(view);
  const insertBlockquoteKeyBinding = useInsertBlockquoteKeyBinding(view);
  const insertLinkKeyBinding = useInsertLinkKeyBinding(view);
  const multiCursorKeyBindings = useAddMultiCursorKeyBindings();

  const sharedKeyBindings: KeyBinding[] = [
    insertNumberedKeyBinding,
    insertBulletListKeyBinding,
    insertBlockquoteKeyBinding,
    insertLinkKeyBinding,
    ...multiCursorKeyBindings,
  ];

  // In emacs mode, formatting keybindings (bold, italic, strikethrough, code)
  // are registered in the emacs plugin via EmacsHandler.bindKey (C-c C-s prefix).
  // Exclude them here to avoid conflicts with Emacs navigation keys.
  if (keymapModeName === 'emacs') {
    return sharedKeyBindings;
  }

  return [
    makeTextBoldKeyBinding,
    makeTextItalicKeyBinding,
    makeTextStrikethroughKeyBinding,
    makeTextCodeCommand,
    ...sharedKeyBindings,
  ];
};

export const useEditorShortcuts = (
  codeMirrorEditor?: UseCodeMirrorEditor,
  keymapModeName?: KeyMapMode,
): void => {
  const keyBindings = useKeyBindings(codeMirrorEditor?.view, keymapModeName);

  // Since key combinations of 4 or more keys cannot be implemented with CodeMirror's keybinding, they are implemented as Extensions.
  const makeCodeBlockExtension = useMakeCodeBlockExtension();

  useEffect(() => {
    const cleanupFunction = codeMirrorEditor?.appendExtensions?.([
      makeCodeBlockExtension,
    ]);
    return cleanupFunction;
  }, [codeMirrorEditor, makeCodeBlockExtension]);

  useEffect(() => {
    if (keyBindings == null) {
      return;
    }

    const keyboardShortcutsExtension = keymap.of(keyBindings);

    const cleanupFunction = codeMirrorEditor?.appendExtensions?.(
      keyboardShortcutsExtension,
    );
    return cleanupFunction;
  }, [codeMirrorEditor, keyBindings]);
};
