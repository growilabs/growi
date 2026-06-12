import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';
import { usePageRenameModalStatus } from '~/states/ui/modal/page-rename.js';

type PageRenameModalProps = Record<string, unknown>;

export const PageRenameModalLazyLoaded = (): JSX.Element => {
  const status = usePageRenameModalStatus();

  const PageRenameModal = useLazyLoader<PageRenameModalProps>(
    'page-rename-modal',
    () =>
      import('./PageRenameModal.js').then((mod) => ({
        default: mod.PageRenameModal,
      })),
    status?.isOpened ?? false,
  );

  return PageRenameModal ? <PageRenameModal /> : <></>;
};
