import { useCallback } from 'react';
import { useTranslation } from 'next-i18next';

export const useTWithOpt = (): ((key: string, opt?: any) => string) => {
  const { t } = useTranslation();

  return useCallback(
    (key, opt) => {
      if (typeof opt === 'object') {
        return t(key, opt).toString();
      }
      return t(key);
    },
    [t],
  );
};
