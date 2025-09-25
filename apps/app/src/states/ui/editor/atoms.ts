import { PageGrant } from '@growi/core/dist/interfaces';
import { isServer } from '@growi/core/dist/utils';
import { atom } from 'jotai';

import type { IPageSelectedGrant } from '~/interfaces/page';

import { EditorMode, EditorModeHash } from './types';
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
  (get, set, newMode: EditorMode) => {
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

/**
 * Atom for editing markdown content
 */
export const editingMarkdownAtom = atom<string>('');

/**
 * Atom for selected grant in page editor
 * Stores temporary grant selection before it's applied to the page
 */
export const selectedGrantAtom = atom<IPageSelectedGrant | null>({
  grant: PageGrant.GRANT_PUBLIC,
});

/**
 * Internal atoms for derived atom usage (special naming convention)
 * These atoms are exposed only for creating derived atoms in other modules
 */
export const _atomsForDerivedAbilities = {
  editorModeAtom,
} as const;
