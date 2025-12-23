import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { useDescendantsPageListModalStatus } from '~/states/ui/modal/descendants-page-list';

type DescendantsPageListModalProps = Record<string, unknown>;

export const DescendantsPageListModalLazyLoaded = (): JSX.Element => {
  const status = useDescendantsPageListModalStatus();

  const DescendantsPageListModal = useLazyLoader<DescendantsPageListModalProps>(
    'descendants-page-list-modal',
    () => import('./DescendantsPageListModal').then(mod => ({ default: mod.DescendantsPageListModal })),
    status?.isOpened ?? false,
  );

  return DescendantsPageListModal ? <DescendantsPageListModal /> : <></>;
};
