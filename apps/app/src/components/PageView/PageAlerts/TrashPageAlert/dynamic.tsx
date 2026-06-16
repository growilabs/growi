import type { JSX } from 'react';

import { useIsTrashPage } from '~/states/page';

import { useLazyLoader } from '../../../utils/use-lazy-loader';

export const TrashPageAlertLazyLoaded = (): JSX.Element => {
  const isTrashPage = useIsTrashPage();

  const TrashPageAlert = useLazyLoader<Record<string, unknown>>(
    'trash-page-alert',
    () =>
      import('./TrashPageAlert').then((mod) => ({
        default: mod.TrashPageAlert,
      })),
    isTrashPage,
  );

  return TrashPageAlert ? <TrashPageAlert /> : <></>;
};
