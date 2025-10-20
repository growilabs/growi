import type { JSX } from 'react';

import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { usePageSelectModalStatus } from '~/states/ui/modal/page-select';

type PageSelectModalProps = Record<string, unknown>;

export const PageSelectModalLazyLoaded = (): JSX.Element => {
  const status = usePageSelectModalStatus();

  const PageSelectModal = useLazyLoader<PageSelectModalProps>(
    'page-select-modal',
    () => import('./PageSelectModal').then(mod => ({ default: mod.PageSelectModal })),
    status?.isOpened ?? false,
  );

  return PageSelectModal ? <PageSelectModal /> : <></>;
};
