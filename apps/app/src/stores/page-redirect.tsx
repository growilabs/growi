import type { SWRResponse } from 'swr';

import { useStaticSWR } from './use-static-swr';

export const useRedirectFrom = (
  initialData?: string | null,
): SWRResponse<string | null, Error> => {
  return useStaticSWR('redirectFrom', initialData);
};
