import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { useIsEditable, usePageNotFound } from '~/states/page';

import {
  editingMarkdownAtom,
  editorModeAtom,
  selectedGrantAtom,
} from './atoms';
import { EditorMode, type UseEditorModeReturn } from './types';

export const useEditorMode = (): UseEditorModeReturn => {
  const isEditable = useIsEditable();
  const isNotFound = usePageNotFound();
  const [editorMode, setEditorModeRaw] = useAtom(editorModeAtom);

  // Check if editor mode should be prevented
  const preventModeEditor =
    !isEditable || isNotFound === undefined || isNotFound === true;

  // Ensure View mode when editing is not allowed
  const finalMode = preventModeEditor ? EditorMode.View : editorMode;

  // Custom setter that respects permissions and updates hash
  const setEditorMode = useCallback(
    (newMode: EditorMode) => {
      if (preventModeEditor && newMode === EditorMode.Editor) {
        // If editing is not allowed, do nothing
        return;
      }
      setEditorModeRaw(newMode);
    },
    [preventModeEditor, setEditorModeRaw],
  );

  const getClassNamesByEditorMode = useCallback(() => {
    const classNames: string[] = [];
    if (finalMode === EditorMode.Editor) {
      classNames.push('editing', 'builtin-editor');
    }
    return classNames;
  }, [finalMode]);

  return {
    editorMode: finalMode,
    setEditorMode,
    getClassNamesByEditorMode,
  };
};

export const useEditingMarkdown = () => useAtomValue(editingMarkdownAtom);
export const useSetEditingMarkdown = () => useSetAtom(editingMarkdownAtom);

/**
 * Hook for managing selected grant in page editor
 * Used for temporary grant selection before applying to the page
 */
export const useSelectedGrant = () => useAtom(selectedGrantAtom);
