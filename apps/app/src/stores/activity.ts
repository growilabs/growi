import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IActivityHasId, ISearchFilter } from '~/interfaces/activity';
import type { PaginateResult } from '~/interfaces/mongoose-utils';
import { useAuditLogEnabled } from '~/stores-universal/context';

export const useSWRxActivity = (
  limit?: number,
  offset?: number,
  searchFilter?: ISearchFilter,
): SWRResponse<PaginateResult<IActivityHasId>, Error> => {
  const { data: auditLogEnabled } = useAuditLogEnabled();

  const stringifiedSearchFilter = JSON.stringify(searchFilter);
  return useSWRImmutable(
    auditLogEnabled
      ? ['/activity', limit, offset, stringifiedSearchFilter]
      : null,
    ([endpoint, limit, offset, stringifiedSearchFilter]) =>
      apiv3Get(endpoint, {
        limit,
        offset,
        searchFilter: stringifiedSearchFilter,
      }).then((result) => result.data.serializedPaginationResult),
  );
};
