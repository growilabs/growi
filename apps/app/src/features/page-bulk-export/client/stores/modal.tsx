import type { SWRResponse } from 'swr';

import { useStaticSWR } from '../../../../stores/use-static-swr';

type PageBulkExportSelectModalStatus = {
  isOpened: boolean;
};

type PageBulkExportSelectModalUtils = {
  open(): Promise<void>;
  close(): Promise<void>;
};

export const usePageBulkExportSelectModal = (): SWRResponse<
  PageBulkExportSelectModalStatus,
  Error
> &
  PageBulkExportSelectModalUtils => {
  const initialStatus: PageBulkExportSelectModalStatus = { isOpened: false };
  const swrResponse = useStaticSWR<PageBulkExportSelectModalStatus, Error>(
    'pageBulkExportSelectModal',
    undefined,
    { fallbackData: initialStatus },
  );

  return {
    ...swrResponse,
    async open() {
      await swrResponse.mutate({ isOpened: true });
    },
    async close() {
      await swrResponse.mutate({ isOpened: false });
    },
  };
};
