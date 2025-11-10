import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { useDrawioModalStatus } from '~/states/ui/modal/drawio';

type DrawioModalProps = Record<string, unknown>;

export const DrawioModalLazyLoaded = (): JSX.Element => {
  const status = useDrawioModalStatus();

  const DrawioModal = useLazyLoader<DrawioModalProps>(
    'drawio-modal',
    () => import('./DrawioModal').then(mod => ({ default: mod.DrawioModal })),
    status?.isOpened ?? false,
  );

  return DrawioModal ? <DrawioModal /> : <></>;
};
