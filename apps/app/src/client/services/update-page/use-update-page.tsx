import { useCallback } from 'react';

import type {
  IApiv3PageUpdateParams,
  IApiv3PageUpdateResponse,
} from '~/interfaces/apiv3/index.js';
import { useSetIsUntitledPage } from '~/states/page/index.js';

import { updatePage } from './update-page.js';

type UseUpdatePage = (
  params: IApiv3PageUpdateParams,
) => Promise<IApiv3PageUpdateResponse>;

export const useUpdatePage = (): UseUpdatePage => {
  const setIsUntitledPage = useSetIsUntitledPage();

  const updatePageExt: UseUpdatePage = useCallback(
    async (params) => {
      const result = await updatePage(params);

      // set false to isUntitledPage
      setIsUntitledPage(false);

      return result;
    },
    [setIsUntitledPage],
  );

  return updatePageExt;
};
