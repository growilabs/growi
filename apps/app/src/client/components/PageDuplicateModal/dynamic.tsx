import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';
import { usePageDuplicateModalStatus } from '~/states/ui/modal/page-duplicate.js';

type PageDuplicateModalProps = Record<string, unknown>;

export const PageDuplicateModalLazyLoaded = (): JSX.Element => {
  const status = usePageDuplicateModalStatus();

  const PageDuplicateModal = useLazyLoader<PageDuplicateModalProps>(
    'page-duplicate-modal',
    () =>
      import('./PageDuplicateModal.js').then((mod) => ({
        default: mod.PageDuplicateModal,
      })),
    status?.isOpened ?? false,
  );

  return PageDuplicateModal ? <PageDuplicateModal /> : <></>;
};
