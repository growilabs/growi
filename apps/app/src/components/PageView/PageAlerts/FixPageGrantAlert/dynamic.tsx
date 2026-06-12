import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';
import { useCurrentUser } from '~/states/global/index.js';
import { useCurrentPageData, usePageNotFound } from '~/states/page/index.js';
import { useSWRxCurrentGrantData } from '~/stores/page.js';

export const FixPageGrantAlertLazyLoaded = (): JSX.Element => {
  const isNotFound = usePageNotFound();
  const currentUser = useCurrentUser();
  const pageData = useCurrentPageData();
  const pageId = pageData?._id;

  const hasParent = pageData != null ? pageData.parent != null : false;
  const { data: dataIsGrantNormalized } = useSWRxCurrentGrantData(
    currentUser != null ? pageId : null,
  );

  const isActive =
    !isNotFound &&
    hasParent &&
    dataIsGrantNormalized?.isGrantNormalized != null &&
    !dataIsGrantNormalized.isGrantNormalized;

  const FixPageGrantAlert = useLazyLoader<Record<string, unknown>>(
    'fix-page-grant-alert',
    () =>
      import('./FixPageGrantAlert.js').then((mod) => ({
        default: mod.FixPageGrantAlert,
      })),
    isActive,
  );

  return FixPageGrantAlert ? <FixPageGrantAlert /> : <></>;
};
