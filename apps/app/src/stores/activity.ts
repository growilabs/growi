import { useAtomValue } from 'jotai';
import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IActivityHasId, ISearchFilter } from '~/interfaces/activity';
import type { PaginateResult } from '~/interfaces/mongoose-utils';
import { auditLogEnabledAtom } from '~/states/server-configurations';

export const useSWRxActivity = (
  limit?: number,
  offset?: number,
  searchFilter?: ISearchFilter,
): SWRResponse<PaginateResult<IActivityHasId>, Error> => {
  const auditLogEnabled = useAtomValue(auditLogEnabledAtom);

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

type auditlogUsernameData = {
  usernames: string[];
  totalCount: number;
};

type auditlogUsernameResult = {
  activeUser?: auditlogUsernameData;
  inactiveUser?: auditlogUsernameData;
  activitySnapshotUser?: auditlogUsernameData;
};

export const useSWRxAuditlogUsernames = (
  q: string,
  offset?: number,
  limit?: number,
): SWRResponse<auditlogUsernameResult, Error> => {
  return useSWRImmutable(
    q != null && q.trim() !== ''
      ? ['/activity/usernames', q, offset, limit]
      : null,
    ([endpoint, q, offset, limit]) =>
      apiv3Get(endpoint, { q, offset, limit }).then((result) => result.data),
  );
};
