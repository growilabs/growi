import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';
import type {
  IResPasswordHashCleanup,
  IResPasswordHashMigrationStatus,
} from '~/interfaces/password-hash-migration';

const MIGRATION_STATUS_ENDPOINT =
  '/security-setting/password-hash/migration-status';

export const useSWRxPasswordHashMigrationStatus = (): SWRResponse<
  IResPasswordHashMigrationStatus,
  Error
> => {
  return useSWR(MIGRATION_STATUS_ENDPOINT, (endpoint) =>
    apiv3Get(endpoint).then((response) => response.data),
  );
};

/**
 * Run the cleanup. Not a mutation hook on purpose: the caller has to re-read the
 * status afterwards anyway (the distribution changes), so it triggers the SWR
 * revalidation itself rather than trying to patch a cached shape.
 */
export const postPasswordHashCleanup =
  async (): Promise<IResPasswordHashCleanup> => {
    const response = await apiv3Post('/security-setting/password-hash/cleanup');
    return response.data;
  };
