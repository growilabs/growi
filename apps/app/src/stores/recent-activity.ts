import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { UserActivitiesResult, IActivityHasId } from '~/interfaces/activity';
import type { PaginateResult } from '~/interfaces/mongoose-utils';

export const useSWRxRecentActivity = (
    limit?: number,
    offset?: number,
    targetUserId?: string,
): SWRResponse<PaginateResult<IActivityHasId>, Error> => {

  const shouldFetch = targetUserId && targetUserId.length > 0;
  const key = shouldFetch ? ['/user-activities', limit, offset, targetUserId] : null;

  const fetcher = ([
    endpoint,
    limitParam,
    offsetParam,
    targetUserIdParam,
  ]) => {

    const promise = apiv3Get<UserActivitiesResult>(endpoint, {
      limit: limitParam,
      offset: offsetParam,
      targetUserId: targetUserIdParam,
    });

    return promise.then(result => result.data.serializedPaginationResult);
  };


  return useSWRImmutable(key, fetcher);
};
