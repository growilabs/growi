import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { toastError } from '~/client/util/toastr';

export const useToastrOnError = <P, R>(
  method?: (param?: P) => Promise<R | undefined>,
): ((param?: P) => Promise<R | undefined>) => {
  const { t } = useTranslation('commons');

  return useCallback(
    async (param) => {
      try {
        return await method?.(param);
      } catch (err) {
        toastError(t('toaster.create_failed', { target: 'a page' }));
      }
    },
    [method, t],
  );
};
