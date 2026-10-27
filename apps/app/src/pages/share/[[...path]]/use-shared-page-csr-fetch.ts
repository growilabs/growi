import { useEffect } from 'react';

import { NextjsRoutingType } from '~/pages/utils/nextjs-routing-utils';
import { useFetchCurrentPage } from '~/states/page';

/**
 * Fetches the shared page on client-side when SSR data cannot be used.
 *
 * Counterpart of useInitialCSRFetch + useSameRouteNavigation for the share link
 * route. Page atoms are hydrated only on the first render, so the page reached by
 * client-side navigation must be fetched. The page is identified by its id from
 * props, because /page/shared cannot resolve a page from the /share/<id> URL.
 */
export const useSharedPageCSRFetch = (condition: {
  nextjsRoutingType: NextjsRoutingType;
  skipSSR?: boolean;
  pageId: string | undefined;
}): void => {
  const { fetchCurrentPage } = useFetchCurrentPage();
  const { nextjsRoutingType, skipSSR, pageId } = condition;

  useEffect(() => {
    if (pageId == null) return;

    const isNavigated = nextjsRoutingType !== NextjsRoutingType.INITIAL;
    if (skipSSR || isNavigated) {
      fetchCurrentPage({ force: true, pageId });
    }
  }, [fetchCurrentPage, nextjsRoutingType, skipSSR, pageId]);
};
