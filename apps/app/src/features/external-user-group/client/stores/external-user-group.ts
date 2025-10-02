import { type SWRResponseWithUtils, withUtils } from '@growi/core/dist/swr';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import type {
  IExternalUserGroupHasId,
  IExternalUserGroupRelationHasId,
  KeycloakGroupSyncSettings,
  LdapGroupSyncSettings,
} from '~/features/external-user-group/interfaces/external-user-group';
import type {
  ChildUserGroupListResult,
  IUserGroupRelationHasIdPopulatedUser,
  UserGroupRelationListResult,
} from '~/interfaces/user-group-response';

export const useSWRxLdapGroupSyncSettings = (): SWRResponse<
  LdapGroupSyncSettings,
  Error
> => {
  return useSWR('/external-user-groups/ldap/sync-settings', (endpoint) =>
    apiv3Get(endpoint).then((response) => {
      return response.data;
    }),
  );
};

export const useSWRxKeycloakGroupSyncSettings = (): SWRResponse<
  KeycloakGroupSyncSettings,
  Error
> => {
  return useSWR('/external-user-groups/keycloak/sync-settings', (endpoint) =>
    apiv3Get(endpoint).then((response) => {
      return response.data;
    }),
  );
};

export const useSWRxExternalUserGroup = (
  groupId: string | null,
): SWRResponse<IExternalUserGroupHasId, Error> => {
  return useSWRImmutable(
    groupId != null ? `/external-user-groups/${groupId}` : null,
    (endpoint) => apiv3Get(endpoint).then((result) => result.data.userGroup),
  );
};

export const useSWRxExternalUserGroupList = (
  initialData?: IExternalUserGroupHasId[],
): SWRResponse<IExternalUserGroupHasId[], Error> => {
  return useSWRImmutable(
    '/external-user-groups',
    (endpoint) =>
      apiv3Get(endpoint, { pagination: false }).then(
        (result) => result.data.userGroups,
      ),
    {
      fallbackData: initialData,
    },
  );
};

type ChildExternalUserGroupListUtils = {
  updateChild(childGroupData: IExternalUserGroupHasId): Promise<void>; // update one child and refresh list
};
export const useSWRxChildExternalUserGroupList = (
  parentIds?: string[],
  includeGrandChildren?: boolean,
): SWRResponseWithUtils<
  ChildExternalUserGroupListUtils,
  ChildUserGroupListResult<IExternalUserGroupHasId>,
  Error
> => {
  const shouldFetch = parentIds != null && parentIds.length > 0;

  const swrResponse = useSWRImmutable(
    shouldFetch
      ? ['/external-user-groups/children', parentIds, includeGrandChildren]
      : null,
    ([endpoint, parentIds, includeGrandChildren]) =>
      apiv3Get<ChildUserGroupListResult<IExternalUserGroupHasId>>(endpoint, {
        parentIds,
        includeGrandChildren,
      }).then((result) => result.data),
  );

  const updateChild = async (childGroupData: IExternalUserGroupHasId) => {
    await apiv3Put(`/external-user-groups/${childGroupData._id}`, {
      description: childGroupData.description,
    });
    swrResponse.mutate();
  };

  return withUtils(swrResponse, { updateChild });
};

export const useSWRxExternalUserGroupRelations = (
  groupId: string | null,
): SWRResponse<IUserGroupRelationHasIdPopulatedUser[], Error> => {
  return useSWRImmutable(
    groupId != null
      ? `/external-user-groups/${groupId}/external-user-group-relations`
      : null,
    (endpoint) =>
      apiv3Get(endpoint).then((result) => result.data.userGroupRelations),
  );
};

export const useSWRxExternalUserGroupRelationList = (
  groupIds: string[] | null,
  childGroupIds?: string[],
  initialData?: IExternalUserGroupRelationHasId[],
): SWRResponse<IExternalUserGroupRelationHasId[], Error> => {
  return useSWRImmutable(
    groupIds != null
      ? ['/external-user-group-relations', groupIds, childGroupIds]
      : null,
    ([endpoint, groupIds, childGroupIds]) =>
      apiv3Get<UserGroupRelationListResult<IExternalUserGroupRelationHasId>>(
        endpoint,
        { groupIds, childGroupIds },
      ).then((result) => result.data.userGroupRelations),
    {
      fallbackData: initialData,
    },
  );
};

export const useSWRxAncestorExternalUserGroups = (
  groupId: string | null,
): SWRResponse<IExternalUserGroupHasId[], Error> => {
  return useSWRImmutable(
    groupId != null ? ['/external-user-groups/ancestors', groupId] : null,
    ([endpoint, groupId]) =>
      apiv3Get(endpoint, { groupId }).then(
        (result) => result.data.ancestorUserGroups,
      ),
  );
};
