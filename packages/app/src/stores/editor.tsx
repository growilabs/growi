import { SWRResponse } from 'swr';
import { useStaticSWR } from './use-static-swr';

export const useIsSlackEnabled = (isEnabled?: boolean): SWRResponse<boolean, Error> => {
  const initialData = false;
  return (
    useStaticSWR('isSlackEnabled', isEnabled || null, { fallbackData: initialData })
  );
};
