import type { IPage, IPagePopulatedToShowRevision } from '@growi/core';
import { useAtomValue } from 'jotai';

import { isContainerFluidAtom } from '~/states/server-configurations';

const useDetermineExpandContent = (
  expandContentWidth?: boolean | null,
): boolean => {
  const dataIsContainerFluid = useAtomValue(isContainerFluidAtom);

  const isContainerFluidDefault = dataIsContainerFluid;
  return expandContentWidth ?? isContainerFluidDefault ?? false;
};

export const useShouldExpandContent = (
  data?: IPage | IPagePopulatedToShowRevision | boolean | null,
): boolean => {
  const expandContentWidth = (() => {
    // when data is null
    if (data == null) {
      return null;
    }
    // when data is boolean
    if (data === true || data === false) {
      return data;
    }
    // when IPage does not have expandContentWidth
    if (!('expandContentWidth' in data)) {
      return null;
    }
    return data.expandContentWidth;
  })();

  return useDetermineExpandContent(expandContentWidth);
};
