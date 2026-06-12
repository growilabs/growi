import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';
import { useIsTrashPage } from '~/states/page/index.js';

export const TrashPageAlertLazyLoaded = (): JSX.Element => {
  const isTrashPage = useIsTrashPage();

  const TrashPageAlert = useLazyLoader<Record<string, unknown>>(
    'trash-page-alert',
    () =>
      import('./TrashPageAlert.js').then((mod) => ({
        default: mod.TrashPageAlert,
      })),
    isTrashPage,
  );

  return TrashPageAlert ? <TrashPageAlert /> : <></>;
};
