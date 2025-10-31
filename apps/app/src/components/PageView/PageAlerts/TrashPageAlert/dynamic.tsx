import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { useIsTrashPage } from '~/states/page';

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
