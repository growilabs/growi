import { useEffect, useRef } from 'react';

import { NextjsRoutingType } from '~/pages/utils/nextjs-routing-utils';
import { useFetchCurrentPage } from '~/states/page';
import { useSetPageAtoms } from '~/states/page/hydrate';

import type { Stage2EachProps } from './types';

/**
 * Hook for keeping page atoms in sync with the share link page props.
 *
 * Counterpart of useSameRouteNavigation + useInitialCSRFetch in [[...path]].
 * Unlike there, every navigation here carries the complete page in props
 * (the share link is resolved only on the server, and /page/shared cannot
 * express a missing or expired link), so the props are applied directly and
 * the page is fetched only when SSR skipped its body.
 */
export const useSharedPageNavigation = (
  props: Pick<Stage2EachProps, 'pageWithMeta' | 'isExpired' | 'skipSSR'> & {
    nextjsRoutingType: NextjsRoutingType;
    currentPathname: string;
  },
): void => {
  const { nextjsRoutingType, currentPathname } = props;
  const setPageAtoms = useSetPageAtoms();
  const { fetchCurrentPage } = useFetchCurrentPage();

  // Props are rebuilt on every render, so run only when the location changes
  const latestPropsRef = useRef(props);
  latestPropsRef.current = props;

  // biome-ignore lint/correctness/useExhaustiveDependencies: currentPathname identifies the navigation
  useEffect(() => {
    const { pageWithMeta, isExpired, skipSSR } = latestPropsRef.current;

    if (nextjsRoutingType !== NextjsRoutingType.INITIAL) {
      setPageAtoms(pageWithMeta?.data ?? undefined, pageWithMeta?.meta);
    }

    const pageId = pageWithMeta?.data?._id;
    if (skipSSR && !isExpired && pageId != null) {
      fetchCurrentPage({ force: true, pageId });
    }
  }, [nextjsRoutingType, currentPathname, setPageAtoms, fetchCurrentPage]);
};
