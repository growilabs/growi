import { useCallback } from 'react';
import { Origin } from '@growi/core';
import { getParentPath } from '@growi/core/dist/utils/path-utils';

import { useCreatePage } from '~/client/services/create-page';
import { usePageNotFound } from '~/states/page';
import { EditorMode, useEditorMode } from '~/states/ui/editor';

import { shouldCreateWipPage } from '../../utils/should-create-wip-page';

export const useStartEditing = (): ((path?: string) => Promise<void>) => {
  const isNotFound = usePageNotFound();
  const { setEditorMode } = useEditorMode();
  const { create } = useCreatePage();

  return useCallback(
    async (path?: string) => {
      if (!isNotFound) {
        setEditorMode(EditorMode.Editor);
        return;
      }
      // Create a new page if it does not exist and transit to the editor mode
      try {
        const parentPath = path != null ? getParentPath(path) : undefined; // does not have to exist
        await create({
          path,
          parentPath,
          wip: shouldCreateWipPage(path),
          origin: Origin.View,
        });

        setEditorMode(EditorMode.Editor);
      } catch (err) {
        throw new Error(err);
      }
    },
    [create, isNotFound, setEditorMode],
  );
};
