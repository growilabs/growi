import { useAtomValue } from 'jotai';
import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Post } from '~/client/util/apiv3-client';
import type { IActivityHasId, ISearchFilter } from '~/interfaces/activity';
import type { PaginateResult } from '~/interfaces/mongoose-utils';
import { auditLogEnabledAtom } from '~/states/server-configurations';

export const useSWRxActivity = (
  limit?: number,
  offset?: number,
  searchFilter?: ISearchFilter,
): SWRResponse<PaginateResult<IActivityHasId>, Error> => {
  const auditLogEnabled = useAtomValue(auditLogEnabledAtom);

  // POST the filter in the request body instead of a GET query string: the
  // searchFilter lists every selected action, which for large action-group
  // configurations pushed the URL past common proxy header limits.
  // The SWR key still uses the stringified filter for stable cache identity.
  const stringifiedSearchFilter = JSON.stringify(searchFilter);
  return useSWRImmutable(
    auditLogEnabled
      ? ['/activity/list', limit, offset, stringifiedSearchFilter]
      : null,
    ([endpoint, limit, offset, stringifiedSearchFilter]) =>
      apiv3Post(endpoint, {
        limit,
        offset,
        searchFilter:
          stringifiedSearchFilter != null
            ? JSON.parse(stringifiedSearchFilter)
            : undefined,
      }).then((result) => result.data.serializedPaginationResult),
  );
};
