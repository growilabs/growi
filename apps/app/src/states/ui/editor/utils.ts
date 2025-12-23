import { isServer } from '@growi/core/dist/utils';

import { EditorMode, EditorModeHash } from './types';

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
