import {
  useSWRxAncestorExternalUserGroups,
  useSWRxChildExternalUserGroupList,
  useSWRxExternalUserGroup,
  useSWRxExternalUserGroupRelationList,
  useSWRxExternalUserGroupRelations,
} from '~/features/external-user-group/client/stores/external-user-group';
import {
  useSWRxAncestorUserGroups,
  useSWRxChildUserGroupList,
  useSWRxUserGroup,
  useSWRxUserGroupRelationList,
  useSWRxUserGroupRelations,
} from '~/stores/user-group';

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const useUserGroup = (userGroupId: string, isExternalGroup: boolean) => {
  const userGroupRes = useSWRxUserGroup(isExternalGroup ? null : userGroupId);
  const externalUserGroupRes = useSWRxExternalUserGroup(
    isExternalGroup ? userGroupId : null,
  );
  return isExternalGroup ? externalUserGroupRes : userGroupRes;
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const useUserGroupRelations = (
  userGroupId: string,
  isExternalGroup: boolean,
) => {
  const userGroupRes = useSWRxUserGroupRelations(
    isExternalGroup ? null : userGroupId,
  );
  const externalUserGroupRes = useSWRxExternalUserGroupRelations(
    isExternalGroup ? userGroupId : null,
  );
  return isExternalGroup ? externalUserGroupRes : userGroupRes;
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const useChildUserGroupList = (
  userGroupId: string,
  isExternalGroup: boolean,
) => {
  const userGroupRes = useSWRxChildUserGroupList(
    !isExternalGroup ? [userGroupId] : [],
    true,
  );
  const externalUserGroupRes = useSWRxChildExternalUserGroupList(
    isExternalGroup ? [userGroupId] : [],
    true,
  );
  return isExternalGroup ? externalUserGroupRes : userGroupRes;
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const useUserGroupRelationList = (
  userGroupIds: string[],
  isExternalGroup: boolean,
) => {
  const userGroupRes = useSWRxUserGroupRelationList(
    isExternalGroup ? null : userGroupIds,
  );
  const externalUserGroupRes = useSWRxExternalUserGroupRelationList(
    isExternalGroup ? userGroupIds : null,
  );
  return isExternalGroup ? externalUserGroupRes : userGroupRes;
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const useAncestorUserGroups = (
  userGroupId: string,
  isExternalGroup: boolean,
) => {
  const userGroupRes = useSWRxAncestorUserGroups(
    isExternalGroup ? null : userGroupId,
  );
  const externalUserGroupRes = useSWRxAncestorExternalUserGroups(
    isExternalGroup ? userGroupId : null,
  );
  return isExternalGroup ? externalUserGroupRes : userGroupRes;
};
