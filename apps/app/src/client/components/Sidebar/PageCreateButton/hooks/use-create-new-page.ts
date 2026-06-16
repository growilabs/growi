import { useCallback } from 'react';
import { Origin } from '@growi/core';

import { useCurrentPagePath } from '~/states/page';

import { useCreatePage } from '../../../../services/create-page';

type UseCreateNewPage = () => {
  isCreating: boolean;
  createNewPage: () => Promise<void>;
};

export const useCreateNewPage: UseCreateNewPage = () => {
  const currentPagePath = useCurrentPagePath();

  const { isCreating, create } = useCreatePage();

  const createNewPage = useCallback(async () => {
    if (currentPagePath == null) return;

    return create(
      {
        parentPath: currentPagePath,
        optionalParentPath: '/',
        wip: true,
        origin: Origin.View,
      },
      {
        skipPageExistenceCheck: true,
      },
    );
  }, [create, currentPagePath]);

  return {
    isCreating,
    createNewPage,
  };
};
