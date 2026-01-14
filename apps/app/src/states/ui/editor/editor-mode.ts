import { useCallback } from 'react';
import { isServer } from '@growi/core/dist/utils';
import { atom, useAtom } from 'jotai';

import { useIsEditable, usePageNotFound } from '~/states/page';

import { EditorMode, EditorModeHash, type UseEditorModeReturn } from './types';
import { determineEditorModeByHash } from './utils';

// Base atom for editor mode
const editorModeBaseAtom = atom<EditorMode | null>(null);

// Derived atom with initialization logic
export const editorModeAtom = atom(
  (get) => {
    const baseMode = get(editorModeBaseAtom);

    // If already initialized, return the current mode
    if (baseMode !== null) {
      return baseMode;
    }

    // Initialize from hash on first access
    return determineEditorModeByHash();
  },
  (_get, set, newMode: EditorMode) => {
    // Update URL hash when mode changes (client-side only)
    if (!isServer()) {
      const { pathname, search } = window.location;
      const hash =
        newMode === EditorMode.Editor
          ? EditorModeHash.Edit
          : EditorModeHash.View;
      window.history.replaceState(null, '', `${pathname}${search}${hash}`);
    }

    set(editorModeBaseAtom, newMode);
  },
);

export const useEditorMode = (): UseEditorModeReturn => {
  const isEditable = useIsEditable();
  const [editorMode, setEditorModeRaw] = useAtom(editorModeAtom);

  // Check if editor mode should be prevented
  const preventModeEditor = !isEditable;

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

/**
 * Internal atoms for derived atom usage (special naming convention)
 * These atoms are exposed only for creating derived atoms in other modules
 */
export const _atomsForDerivedAbilities = {
  editorModeAtom,
} as const;
