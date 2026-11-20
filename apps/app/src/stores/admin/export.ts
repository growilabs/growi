import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';

// Collections that must never be offered as export targets.
const IGNORED_COLLECTION_NAMES = [
  'sessions',
  'rlflx',
  'yjs-writings',
  'transferkeys',
];

export interface IExportStatus {
  zipFileStats: any[];
  isExporting: boolean;
  progressList: any[] | null;
}

/**
 * Server-derived export status.
 *
 * `zipFileStats` (the exported-archive list) is derived from the filesystem by
 * the server's `GET /export/status`, so it is server state and must be read
 * through SWR — never mirrored or accumulated on the client. Callers revalidate
 * with the returned `mutate` after an export completes or an archive is deleted,
 * which keeps the displayed list equal to the single source of truth and makes
 * duplicate rows impossible (see #11509).
 */
export const useSWRxExportStatus = (): SWRResponse<IExportStatus, Error> => {
  return useSWRImmutable('/export/status', async (endpoint) => {
    const { data } = await apiv3Get<{ status: IExportStatus }>(endpoint);
    return data.status;
  });
};

export const useSWRxExportCollections = (): SWRResponse<string[], Error> => {
  return useSWRImmutable('/mongo/collections', async (endpoint) => {
    const { data } = await apiv3Get<{ collections: string[] }>(endpoint);
    return data.collections.filter(
      (collectionName) => !IGNORED_COLLECTION_NAMES.includes(collectionName),
    );
  });
};
