import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { UserActivitiesResult, IActivityHasId } from '~/interfaces/activity';
import type { PaginateResult } from '~/interfaces/mongoose-utils';

export const useSWRxRecentActivity = (
    limit?: number,
    offset?: number,
): SWRResponse<PaginateResult<IActivityHasId>, Error> => {

  const key = ['/user-activities', limit, offset];

  const fetcher = ([
    endpoint,
    limitParam,
    offsetParam,
  ]) => {

    const promise = apiv3Get<UserActivitiesResult>(endpoint, {
      limit: limitParam,
      offset: offsetParam,
    });

    return promise.then(result => result.data.serializedPaginationResult);
  };


  return useSWRImmutable(key, fetcher);
};
