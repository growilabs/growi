import type { JSX } from 'react';

import { useLazyLoader } from '~/client/util/use-lazy-loader';

import { usePageBulkExportSelectModalStatus } from '../states/modal';

type PageBulkExportSelectModalProps = Record<string, unknown>;

export const PageBulkExportSelectModalLazyLoaded = (): JSX.Element => {
  const status = usePageBulkExportSelectModalStatus();

  const PageBulkExportSelectModal =
    useLazyLoader<PageBulkExportSelectModalProps>(
      'page-bulk-export-select-modal',
      () =>
        import('./PageBulkExportSelectModal').then((mod) => ({
          default: mod.PageBulkExportSelectModal,
        })),
      status?.isOpened ?? false,
    );

  return PageBulkExportSelectModal ? <PageBulkExportSelectModal /> : <></>;
};
