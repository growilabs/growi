import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IActivityHasId, IRecentActivitySearchFilter } from '~/interfaces/activity';
import type { PaginateResult } from '~/interfaces/mongoose-utils';

export const useSWRxRecentActivity = (limit?: number, offset?: number, searchFilter?: IRecentActivitySearchFilter):
  SWRResponse<PaginateResult<IActivityHasId>, Error> => {

  const stringifiedSearchFilter = JSON.stringify(searchFilter);

  const key = ['/user-activities', limit, offset, stringifiedSearchFilter];

  const fetcher = ([endpoint, limit, offset, stringifiedSearchFilter]) => apiv3Get(endpoint, { limit, offset, searchFilter: stringifiedSearchFilter })
    .then(result => result.data.serializedPaginationResult);


  return useSWRImmutable(key, fetcher);
};
