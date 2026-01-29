import { useEffect } from 'react';
import { useRouter } from 'next/router';

import { useFetchCurrentPage } from '~/states/page';

import { NextjsRoutingType } from '../utils/nextjs-routing-utils';

/**
 * Hook for handling initial CSR fetch when SSR data is not available.
 *
 * Responsibilities:
 * - Fetches page data on client-side when skipSSR is true
 *   (e.g., when page content exceeds ssrMaxRevisionBodyLength)
 * - Fetches page data on client-side when navigating from outside routes (FROM_OUTSIDE)
 *   (e.g., when navigating from /_search to /page)
 *
 * Note: SAME_ROUTE navigation is handled by useSameRouteNavigation.
 */
export const useInitialCSRFetch = (condition: {
  nextjsRoutingType: NextjsRoutingType;
  skipSSR?: boolean;
}): void => {
  const router = useRouter();
  const { fetchCurrentPage } = useFetchCurrentPage();

  useEffect(() => {
    const isFromOutside =
      condition.nextjsRoutingType === NextjsRoutingType.FROM_OUTSIDE;
    if (condition.skipSSR || isFromOutside) {
      // Pass current path to ensure fetching the correct page
      // (atoms may contain stale data from the previous page)
      fetchCurrentPage({ force: true, path: router.asPath });
    }
  }, [
    fetchCurrentPage,
    condition.skipSSR,
    condition.nextjsRoutingType,
    router.asPath,
  ]);
};
