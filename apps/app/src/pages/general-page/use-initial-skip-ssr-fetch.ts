import { useEffect } from 'react';

import { useFetchCurrentPage } from '~/states/page';

import { NextjsRoutingType } from '../utils/nextjs-routing-utils';

/**
 * useInitialCSRFetch
 *
 * Fetches current page data on client-side by conditionally
 */
export const useInitialCSRFetch = (condition: {
  nextjsRoutingType: NextjsRoutingType;
  skipSSR?: boolean;
}): void => {
  const { fetchCurrentPage } = useFetchCurrentPage();

  // Should fetch page data on client-side or not
  const shouldFetch =
    condition.nextjsRoutingType === NextjsRoutingType.FROM_OUTSIDE ||
    condition.skipSSR;

  // Note: When the nextjsRoutingType is SAME_ROUTE, the data fetching is handled by useSameRouteNavigation

  useEffect(() => {
    if (shouldFetch) {
      fetchCurrentPage({ force: true });
    }
  }, [fetchCurrentPage, shouldFetch]);
};
