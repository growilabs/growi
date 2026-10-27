import { useEffect } from 'react';
import type { EditorView } from '@codemirror/view';
import { type KeyBinding, keymap } from '@codemirror/view';

import type { UseCodeMirrorEditor } from '../services/index.js';
import { useAddMultiCursorKeyBindings } from '../services/use-codemirror-editor/utils/editor-shortcuts/add-multi-cursor.js';
import { useInsertBlockquoteKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/insert-blockquote.js';
import { useInsertBulletListKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/insert-bullet-list.js';
import { useInsertLinkKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/insert-link.js';
import { useInsertNumberedKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/insert-numbered-list.js';
import { useMakeTextBoldKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/make-text-bold.js';
import { useMakeTextCodeKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/make-text-code.js';
import { useMakeCodeBlockExtension } from '../services/use-codemirror-editor/utils/editor-shortcuts/make-text-code-block.js';
import { useMakeTextItalicKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/make-text-italic.js';
import { useMakeTextStrikethroughKeyBinding } from '../services/use-codemirror-editor/utils/editor-shortcuts/make-text-strikethrough.js';
import type { ShortcutCategory } from '../services-internal/keymaps/index.js';

interface CategorizedKeyBindings {
  readonly category: ShortcutCategory | null;
  readonly bindings: readonly KeyBinding[];
}

const useKeyBindings = (
  view?: EditorView,
  overrides?: readonly ShortcutCategory[],
): KeyBinding[] => {
  // Formatting keybindings
  const makeTextBoldKeyBinding = useMakeTextBoldKeyBinding(view);
  const makeTextItalicKeyBinding = useMakeTextItalicKeyBinding(view);
  const makeTextStrikethroughKeyBinding =
    useMakeTextStrikethroughKeyBinding(view);
  const makeTextCodeCommand = useMakeTextCodeKeyBinding(view);

  // Structural keybindings
  const insertNumberedKeyBinding = useInsertNumberedKeyBinding(view);
  const insertBulletListKeyBinding = useInsertBulletListKeyBinding(view);
  const insertBlockquoteKeyBinding = useInsertBlockquoteKeyBinding(view);
  const insertLinkKeyBinding = useInsertLinkKeyBinding(view);

  // Always-on keybindings
  const multiCursorKeyBindings = useAddMultiCursorKeyBindings();

  const allGroups: CategorizedKeyBindings[] = [
    {
      category: 'formatting',
      bindings: [
        makeTextBoldKeyBinding,
        makeTextItalicKeyBinding,
        makeTextStrikethroughKeyBinding,
        makeTextCodeCommand,
      ],
    },
    {
      category: 'structural',
      bindings: [
        insertNumberedKeyBinding,
        insertBulletListKeyBinding,
        insertBlockquoteKeyBinding,
        insertLinkKeyBinding,
      ],
    },
    {
      category: null,
      bindings: multiCursorKeyBindings,
    },
  ];

  return allGroups
    .filter(
      (group) =>
        group.category === null || !overrides?.includes(group.category),
    )
    .flatMap((group) => [...group.bindings]);
};

export const useEditorShortcuts = (
  codeMirrorEditor?: UseCodeMirrorEditor,
  overrides?: readonly ShortcutCategory[],
): void => {
  const keyBindings = useKeyBindings(codeMirrorEditor?.view, overrides);

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
