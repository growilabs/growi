import type {
  IPageHasId,
  IUserGroupHasId,
  IUserGroupRelationHasId,
} from '@growi/core';
import { type SWRResponseWithUtils, withUtils } from '@growi/core/dist/swr';
import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import type {
  AncestorUserGroupsResult,
  ChildUserGroupListResult,
  IUserGroupRelationHasIdPopulatedUser,
  SelectableParentUserGroupsResult,
  SelectableUserChildGroupsResult,
  UserGroupListResult,
  UserGroupPagesResult,
  UserGroupRelationListResult,
  UserGroupRelationsResult,
  UserGroupResult,
} from '~/interfaces/user-group-response';

export const useSWRxUserGroup = (
  groupId: string | null,
): SWRResponse<IUserGroupHasId, Error> => {
  return useSWRImmutable(
    groupId != null ? `/user-groups/${groupId}` : null,
    (endpoint) =>
      apiv3Get<UserGroupResult>(endpoint).then(
        (result) => result.data.userGroup,
      ),
  );
};

export const useSWRxUserGroupList = (
  initialData?: IUserGroupHasId[],
  isExternalGroup = false,
): SWRResponse<IUserGroupHasId[], Error> => {
  const url = isExternalGroup ? '/external-user-groups' : '/user-groups';
  return useSWRImmutable(
    url,
    (endpoint) =>
      apiv3Get<UserGroupListResult>(endpoint, { pagination: false }).then(
        (result) => result.data.userGroups,
      ),
    {
      fallbackData: initialData,
    },
  );
};

type ChildUserGroupListUtils = {
  updateChild(childGroupData: IUserGroupHasId): Promise<void>; // update one child and refresh list
};
export const useSWRxChildUserGroupList = (
  parentIds?: string[],
  includeGrandChildren?: boolean,
): SWRResponseWithUtils<
  ChildUserGroupListUtils,
  ChildUserGroupListResult,
  Error
> => {
  const shouldFetch = parentIds != null && parentIds.length > 0;

  const swrResponse = useSWRImmutable(
    shouldFetch
      ? ['/user-groups/children', parentIds, includeGrandChildren]
      : null,
    ([endpoint, parentIds, includeGrandChildren]) =>
      apiv3Get<ChildUserGroupListResult>(endpoint, {
        parentIds,
        includeGrandChildren,
      }).then((result) => result.data),
  );

  const updateChild = async (childGroupData: IUserGroupHasId) => {
    await apiv3Put(`/user-groups/${childGroupData._id}`, {
      name: childGroupData.name,
      description: childGroupData.description,
      parentId: childGroupData.parent,
    });
    swrResponse.mutate();
  };

  return withUtils(swrResponse, { updateChild });
};

export const useSWRxUserGroupRelations = (
  groupId: string | null,
): SWRResponse<IUserGroupRelationHasIdPopulatedUser[], Error> => {
  return useSWRImmutable(
    groupId != null ? `/user-groups/${groupId}/user-group-relations` : null,
    (endpoint) =>
      apiv3Get<UserGroupRelationsResult>(endpoint).then(
        (result) => result.data.userGroupRelations,
      ),
  );
};

export const useSWRxUserGroupRelationList = (
  groupIds: string[] | null,
  childGroupIds?: string[],
  initialData?: IUserGroupRelationHasId[],
): SWRResponse<IUserGroupRelationHasId[], Error> => {
  return useSWRImmutable(
    groupIds != null
      ? ['/user-group-relations', groupIds, childGroupIds]
      : null,
    ([endpoint, groupIds, childGroupIds]) =>
      apiv3Get<UserGroupRelationListResult>(endpoint, {
        groupIds,
        childGroupIds,
      }).then((result) => result.data.userGroupRelations),
    {
      fallbackData: initialData,
    },
  );
};

export const useSWRxUserGroupPages = (
  groupId: string | undefined,
  limit: number,
  offset: number,
): SWRResponse<IPageHasId[], Error> => {
  return useSWRImmutable(
    groupId != null ? [`/user-groups/${groupId}/pages`, limit, offset] : null,
    ([endpoint, limit, offset]) =>
      apiv3Get<UserGroupPagesResult>(endpoint, { limit, offset }).then(
        (result) => result.data.pages,
      ),
  );
};

export const useSWRxSelectableParentUserGroups = (
  groupId: string | null,
): SWRResponse<IUserGroupHasId[], Error> => {
  return useSWRImmutable(
    groupId != null ? ['/user-groups/selectable-parent-groups', groupId] : null,
    ([endpoint, groupId]) =>
      apiv3Get<SelectableParentUserGroupsResult>(endpoint, { groupId }).then(
        (result) => result.data.selectableParentGroups,
      ),
  );
};

export const useSWRxSelectableChildUserGroups = (
  groupId: string | null,
): SWRResponse<IUserGroupHasId[], Error> => {
  return useSWRImmutable(
    groupId != null ? ['/user-groups/selectable-child-groups', groupId] : null,
    ([endpoint, groupId]) =>
      apiv3Get<SelectableUserChildGroupsResult>(endpoint, { groupId }).then(
        (result) => result.data.selectableChildGroups,
      ),
  );
};

export const useSWRxAncestorUserGroups = (
  groupId: string | null,
): SWRResponse<IUserGroupHasId[], Error> => {
  return useSWRImmutable(
    groupId != null ? ['/user-groups/ancestors', groupId] : null,
    ([endpoint, groupId]) =>
      apiv3Get<AncestorUserGroupsResult>(endpoint, { groupId }).then(
        (result) => result.data.ancestorUserGroups,
      ),
  );
};
