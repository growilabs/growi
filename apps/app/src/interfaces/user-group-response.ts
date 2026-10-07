import type {
  HasObjectId,
  IPageHasId,
  IUserGroup,
  IUserGroupHasId,
  IUserGroupRelationHasId,
  IUserHasId,
  Ref,
} from '@growi/core';

export type UserGroupResult = {
  userGroup: IUserGroupHasId;
};

export type UserGroupListResult<
  TUSERGROUP extends IUserGroupHasId = IUserGroupHasId,
> = {
  userGroups: TUSERGROUP[];
};

export type ChildUserGroupListResult<
  TUSERGROUP extends IUserGroupHasId = IUserGroupHasId,
> = {
  childUserGroups: TUSERGROUP[];
  grandChildUserGroups: TUSERGROUP[];
};

export type UserGroupRelationListResult<
  TUSERGROUPRELATION extends IUserGroupRelationHasId = IUserGroupRelationHasId,
> = {
  userGroupRelations: TUSERGROUPRELATION[];
};

export type IUserGroupRelationHasIdPopulatedUser<
  TUSERGROUP extends IUserGroup = IUserGroup,
> = {
  relatedGroup: Ref<TUSERGROUP>;
  relatedUser: IUserHasId;
  createdAt: Date;
} & HasObjectId;

export type UserGroupRelationsResult = {
  userGroupRelations: IUserGroupRelationHasIdPopulatedUser[];
};

export type UserGroupPagesResult = {
  pages: IPageHasId[];
};

export type SelectableParentUserGroupsResult = {
  selectableParentGroups: IUserGroupHasId[];
};

export type SelectableUserChildGroupsResult = {
  selectableChildGroups: IUserGroupHasId[];
};

export type AncestorUserGroupsResult = {
  ancestorUserGroups: IUserGroupHasId[];
};
