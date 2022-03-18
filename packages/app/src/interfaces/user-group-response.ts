import { IUserGroupHasId, IUserGroupRelationHasId } from './user';
import { IPageHasId } from './page';

export type UserGroupResult = {
  userGroup: IUserGroupHasId,
}

export type UserGroupListResult = {
  userGroups: IUserGroupHasId[],
};

export type ChildUserGroupListResult = {
  childUserGroups: IUserGroupHasId[],
  grandChildUserGroups: IUserGroupHasId[],
};

export type UserGroupRelationListResult = {
  userGroupRelations: IUserGroupRelationHasId[],
};

export type UserGroupPagesResult = {
  pages: IPageHasId[],
}

export type SelectableParentUserGroupsResult = {
  selectableParentGroups: IUserGroupHasId[],
}

export type SelectableUserChildGroupsResult = {
  selectableChildGroups: IUserGroupHasId[],
}

export type AncestorUserGroupsResult = {
  ancestorUserGroups: IUserGroupHasId[],
}
