import { useEffect } from 'react';

import { useFetchCurrentPage } from '~/states/page';

/**
 * useInitialCSRFetch
 *
 * Fetches current page data on client-side if shouldFetch === true
 *
 * @param shouldFetch - Whether SSR is skipped (from props)
 */
export const useInitialCSRFetch = (shouldFetch?: boolean): void => {
  const { fetchCurrentPage } = useFetchCurrentPage();

  useEffect(() => {
    if (shouldFetch) {
      fetchCurrentPage({ force: true });
    }
  }, [fetchCurrentPage, shouldFetch]);
};
