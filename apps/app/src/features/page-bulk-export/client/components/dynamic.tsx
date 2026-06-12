import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';

import { usePageBulkExportSelectModalStatus } from '../states/modal.js';

type PageBulkExportSelectModalProps = Record<string, unknown>;

export const PageBulkExportSelectModalLazyLoaded = (): JSX.Element => {
  const status = usePageBulkExportSelectModalStatus();

  const PageBulkExportSelectModal =
    useLazyLoader<PageBulkExportSelectModalProps>(
      'page-bulk-export-select-modal',
      () =>
        import('./PageBulkExportSelectModal.js').then((mod) => ({
          default: mod.PageBulkExportSelectModal,
        })),
      status?.isOpened ?? false,
    );

  return PageBulkExportSelectModal ? <PageBulkExportSelectModal /> : <></>;
};
