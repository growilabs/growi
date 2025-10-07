import { useCallback } from 'react';

import { Origin } from '@growi/core';
import { isCreatablePage } from '@growi/core/dist/utils/page-path-utils';
import { normalizePath } from '@growi/core/dist/utils/path-utils';

import type { LabelType } from '~/interfaces/template';
import { useCurrentPagePath } from '~/states/page';


import { useCreatePage } from './use-create-page';

type UseCreateTemplatePage = () => {
  isCreatable: boolean,
  isCreating: boolean,
  createTemplate?: (label: LabelType) => Promise<void>,
}

export const useCreateTemplatePage: UseCreateTemplatePage = () => {

  const currentPagePath = useCurrentPagePath();

  const { isCreating, create } = useCreatePage();
  const isCreatable = currentPagePath != null && isCreatablePage(normalizePath(`${currentPagePath}/_template`));

  const createTemplate = useCallback(async(label: LabelType) => {
    if (currentPagePath == null || !isCreatable) return;

    return create(
      {
        path: normalizePath(`${currentPagePath}/${label}`), parentPath: currentPagePath, wip: false, origin: Origin.View,
      },
    );
  }, [currentPagePath, isCreatable, create]);

  return {
    isCreatable,
    isCreating,
    createTemplate: isCreatable ? createTemplate : undefined,
  };
};
