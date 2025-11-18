/** **********************************************************
 *                          Unions
 *********************************************************** */

import { useCallback } from 'react';
import type { SWRResponseWithUtils } from '@growi/core/dist/swr';
import { isServer } from '@growi/core/dist/utils';
import useSWRImmutable from 'swr/immutable';

import { useIsNotFound } from '~/stores/page';

import { useIsEditable } from './context';

export const EditorMode = {
  View: 'view',
  Editor: 'editor',
} as const;
export type EditorMode = (typeof EditorMode)[keyof typeof EditorMode];

const getClassNamesByEditorMode = (
  editorMode: EditorMode | undefined,
): string[] => {
  const classNames: string[] = [];
  switch (editorMode) {
    case EditorMode.Editor:
      classNames.push('editing', 'builtin-editor');
      break;
  }

  return classNames;
};

export const EditorModeHash = {
  View: '',
  Edit: '#edit',
} as const;
export type EditorModeHash =
  (typeof EditorModeHash)[keyof typeof EditorModeHash];

const updateHashByEditorMode = (newEditorMode: EditorMode) => {
  const { pathname, search } = window.location;

  switch (newEditorMode) {
    case EditorMode.View:
      window.history.replaceState(
        null,
        '',
        `${pathname}${search}${EditorModeHash.View}`,
      );
      break;
    case EditorMode.Editor:
      window.history.replaceState(
        null,
        '',
        `${pathname}${search}${EditorModeHash.Edit}`,
      );
      break;
  }
};

export const determineEditorModeByHash = (): EditorMode => {
  if (isServer()) {
    return EditorMode.View;
  }

  const { hash } = window.location;

  switch (hash) {
    case EditorModeHash.Edit:
      return EditorMode.Editor;
    default:
      return EditorMode.View;
  }
};

type EditorModeUtils = {
  getClassNamesByEditorMode: () => string[];
};

export const useEditorMode = (): SWRResponseWithUtils<
  EditorModeUtils,
  EditorMode
> => {
  const { data: _isEditable } = useIsEditable();
  const { data: isNotFound } = useIsNotFound();

  const editorModeByHash = determineEditorModeByHash();

  const isLoading = _isEditable === undefined;
  const isEditable = !isLoading && _isEditable;
  const preventModeEditor =
    !isEditable || isNotFound === undefined || isNotFound === true;
  const initialData = preventModeEditor ? EditorMode.View : editorModeByHash;

  const swrResponse = useSWRImmutable(
    isLoading ? null : ['editorMode', isEditable, preventModeEditor],
    null,
    { fallbackData: initialData },
  );

  // construct overriding mutate method
  const mutateOriginal = swrResponse.mutate;
  const mutate = useCallback(
    (editorMode: EditorMode, shouldRevalidate?: boolean) => {
      if (preventModeEditor) {
        return Promise.resolve(EditorMode.View); // fixed if not editable
      }
      updateHashByEditorMode(editorMode);
      return mutateOriginal(editorMode, shouldRevalidate);
    },
    [preventModeEditor, mutateOriginal],
  );

  const getClassNames = useCallback(() => {
    return getClassNamesByEditorMode(swrResponse.data);
  }, [swrResponse.data]);

  return Object.assign(swrResponse, {
    mutate,
    getClassNamesByEditorMode: getClassNames,
  });
};
