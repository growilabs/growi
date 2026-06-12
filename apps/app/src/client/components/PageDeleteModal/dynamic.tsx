import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';
import { usePageDeleteModalStatus } from '~/states/ui/modal/page-delete.js';

type PageDeleteModalProps = Record<string, unknown>;

export const PageDeleteModalLazyLoaded = (): JSX.Element => {
  const status = usePageDeleteModalStatus();

  const PageDeleteModal = useLazyLoader<PageDeleteModalProps>(
    'page-delete-modal',
    () =>
      import('./PageDeleteModal.js').then((mod) => ({
        default: mod.PageDeleteModal,
      })),
    status?.isOpened ?? false,
  );

  return PageDeleteModal ? <PageDeleteModal /> : <></>;
};
