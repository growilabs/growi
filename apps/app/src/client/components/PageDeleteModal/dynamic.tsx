import type { JSX } from 'react';

import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { usePageDeleteModalStatus } from '~/states/ui/modal/page-delete';

type PageDeleteModalProps = Record<string, unknown>;

export const PageDeleteModalLazyLoaded = (): JSX.Element => {
  const status = usePageDeleteModalStatus();

  const PageDeleteModal = useLazyLoader<PageDeleteModalProps>(
    'page-delete-modal',
    () => import('./PageDeleteModal').then(mod => ({ default: mod.PageDeleteModal })),
    status?.isOpened ?? false,
  );

  return PageDeleteModal ? <PageDeleteModal /> : <></>;
};
