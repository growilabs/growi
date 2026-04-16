import { useCallback, useEffect, useRef, useState } from 'react';
import type { Extension } from '@codemirror/state';
import { Prec } from '@codemirror/state';
import {
  type Command,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
} from '@codemirror/view';

import type { EditorSettings, EditorTheme, KeyMapMode } from '../../consts';
import type { UseCodeMirrorEditor } from '../services';
import {
  getEditorTheme,
  getKeymap,
  insertNewlineContinueMarkup,
  insertNewRowToMarkdownTable,
  isInTable,
} from '../services-internal';
import type { KeymapResult } from '../services-internal/keymaps';
import { useEditorShortcuts } from './use-editor-shortcuts';

const useStyleActiveLine = (
  codeMirrorEditor?: UseCodeMirrorEditor,
  styleActiveLine?: boolean,
): void => {
  useEffect(() => {
    if (styleActiveLine == null) {
      return;
    }
    const extensions = styleActiveLine
      ? [[highlightActiveLine(), highlightActiveLineGutter()]]
      : [[]];
    const cleanupFunction = codeMirrorEditor?.appendExtensions?.(extensions);
    return cleanupFunction;
  }, [codeMirrorEditor, styleActiveLine]);
};

const useEnterKeyHandler = (
  codeMirrorEditor?: UseCodeMirrorEditor,
  autoFormatMarkdownTable?: boolean,
): void => {
  const onPressEnter: Command = useCallback(
    (editor) => {
      if (isInTable(editor) && autoFormatMarkdownTable) {
        insertNewRowToMarkdownTable(editor);
        return true;
      }
      insertNewlineContinueMarkup(editor);
      return true;
    },
    [autoFormatMarkdownTable],
  );

  useEffect(() => {
    const extension = keymap.of([{ key: 'Enter', run: onPressEnter }]);
    const cleanupFunction = codeMirrorEditor?.appendExtensions?.(extension);
    return cleanupFunction;
  }, [codeMirrorEditor, onPressEnter]);
};

const useThemeExtension = (
  codeMirrorEditor?: UseCodeMirrorEditor,
  theme?: EditorTheme,
): void => {
  const [themeExtension, setThemeExtension] = useState<Extension | undefined>(
    undefined,
  );

  useEffect(() => {
    const settingTheme = async (name?: EditorTheme) => {
      setThemeExtension(await getEditorTheme(name));
    };
    settingTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (themeExtension == null) {
      return;
    }
    const cleanupFunction = codeMirrorEditor?.appendExtensions(
      Prec.high(themeExtension),
    );
    return cleanupFunction;
  }, [codeMirrorEditor, themeExtension]);
};

const useKeymapExtension = (
  codeMirrorEditor?: UseCodeMirrorEditor,
  keymapMode?: KeyMapMode,
  onSave?: () => void,
): KeymapResult | undefined => {
  const [keymapResult, setKeymapResult] = useState<KeymapResult | undefined>(
    undefined,
  );

  // Use ref for onSave to prevent keymap extension recreation on callback changes
  // This is critical for Vim mode to preserve insert mode state
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const settingKeyMap = async (name?: KeyMapMode) => {
      // Pass a stable wrapper function that delegates to the ref
      const stableOnSave = () => onSaveRef.current?.();
      setKeymapResult(await getKeymap(name, stableOnSave));
    };
    settingKeyMap(keymapMode);
  }, [keymapMode]);

  useEffect(() => {
    if (keymapResult == null) {
      return;
    }
    const cleanupFunction = codeMirrorEditor?.appendExtensions(
      keymapResult.precedence(keymapResult.extension),
    );
    return cleanupFunction;
  }, [codeMirrorEditor, keymapResult]);

  return keymapResult;
};

export const useEditorSettings = (
  codeMirrorEditor?: UseCodeMirrorEditor,
  editorSettings?: EditorSettings,
  onSave?: () => void,
): void => {
  const keymapResult = useKeymapExtension(
    codeMirrorEditor,
    editorSettings?.keymapMode,
    onSave,
  );
  useEditorShortcuts(codeMirrorEditor, keymapResult?.overrides);
  useStyleActiveLine(codeMirrorEditor, editorSettings?.styleActiveLine);
  useEnterKeyHandler(codeMirrorEditor, editorSettings?.autoFormatMarkdownTable);
  useThemeExtension(codeMirrorEditor, editorSettings?.theme);
};
