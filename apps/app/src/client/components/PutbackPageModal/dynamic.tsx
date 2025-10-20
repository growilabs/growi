import type { JSX } from 'react';

import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { usePutBackPageModalStatus } from '~/states/ui/modal/put-back-page';

type PutBackPageModalProps = Record<string, unknown>;

export const PutBackPageModalLazyLoaded = (): JSX.Element => {
  const status = usePutBackPageModalStatus();

  const PutBackPageModal = useLazyLoader<PutBackPageModalProps>(
    'put-back-page-modal',
    () => import('./PutbackPageModal').then(mod => ({ default: mod.PutBackPageModal })),
    status?.isOpened ?? false,
  );

  return PutBackPageModal ? <PutBackPageModal /> : <></>;
};
