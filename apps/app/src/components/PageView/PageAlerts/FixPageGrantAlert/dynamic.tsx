import type { JSX } from 'react';

import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { useCurrentUser } from '~/states/global';
import { useCurrentPageData, usePageNotFound } from '~/states/page';
import { useSWRxCurrentGrantData } from '~/stores/page';

export const FixPageGrantAlertLazyLoaded = (): JSX.Element => {
  const isNotFound = usePageNotFound();
  const currentUser = useCurrentUser();
  const pageData = useCurrentPageData();
  const pageId = pageData?._id;

  const hasParent = pageData != null ? pageData.parent != null : false;
  const { data: dataIsGrantNormalized } = useSWRxCurrentGrantData(currentUser != null ? pageId : null);

  const isActive = !isNotFound
    && hasParent
    && dataIsGrantNormalized?.isGrantNormalized != null
    && !dataIsGrantNormalized.isGrantNormalized;

  const FixPageGrantAlert = useLazyLoader<Record<string, unknown>>(
    'fix-page-grant-alert',
    () => import('./FixPageGrantAlert').then((mod) => ({ default: mod.FixPageGrantAlert })),
    isActive,
  );

  return FixPageGrantAlert ? <FixPageGrantAlert /> : <></>;
};
