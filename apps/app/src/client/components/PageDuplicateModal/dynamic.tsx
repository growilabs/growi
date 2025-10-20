import type { JSX } from 'react';

import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { usePageDuplicateModalStatus } from '~/states/ui/modal/page-duplicate';

type PageDuplicateModalProps = Record<string, unknown>;

export const PageDuplicateModalLazyLoaded = (): JSX.Element => {
  const status = usePageDuplicateModalStatus();

  const PageDuplicateModal = useLazyLoader<PageDuplicateModalProps>(
    'page-duplicate-modal',
    () => import('./PageDuplicateModal').then(mod => ({ default: mod.PageDuplicateModal })),
    status?.isOpened ?? false,
  );

  return PageDuplicateModal ? <PageDuplicateModal /> : <></>;
};
