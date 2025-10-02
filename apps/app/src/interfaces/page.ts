import type {
  GroupType,
  IGrantedGroup,
  IPageHasId,
  Nullable,
  Origin,
  PageGrant,
} from '@growi/core';

import type { ExternalGroupProviderType } from '~/features/external-user-group/interfaces/external-user-group';

import type { IPageOperationProcessData } from './page-operation';

export {
  isIPageInfoForEntity,
  isIPageInfoForListing,
  isIPageInfoForOperation,
} from '@growi/core';

export type IPageForItem = Partial<
  IPageHasId & { processData?: IPageOperationProcessData }
>;

export const UserGroupPageGrantStatus = {
  isGranted: 'isGranted',
  notGranted: 'notGranted',
  cannotGrant: 'cannotGrant',
};
type UserGroupPageGrantStatus =
  (typeof UserGroupPageGrantStatus)[keyof typeof UserGroupPageGrantStatus];
export type UserRelatedGroupsData = {
  id: string;
  name: string;
  type: GroupType;
  provider?: ExternalGroupProviderType;
  status: UserGroupPageGrantStatus;
};
export type GroupGrantData = {
  userRelatedGroups: UserRelatedGroupsData[];
  nonUserRelatedGrantedGroups: {
    id: string;
    name: string;
    type: GroupType;
    provider?: ExternalGroupProviderType;
  }[];
};
// current grant data of page
export type IPageGrantData = {
  grant: PageGrant;
  groupGrantData?: GroupGrantData;
};
// grant selected by user which is not yet applied
export type IPageSelectedGrant = {
  grant: PageGrant;
  userRelatedGrantedGroups?: IGrantedGroup[];
};

export type IDeleteSinglePageApiv1Result = {
  ok: boolean;
  path: string;
  isRecursively: Nullable<true>;
  isCompletely: Nullable<true>;
};

export type IDeleteManyPageApiv3Result = {
  paths: string[];
  isRecursively: Nullable<true>;
  isCompletely: Nullable<true>;
};

export type IOptionsForUpdate = {
  origin?: Origin;
  wip?: boolean;
  grant?: PageGrant;
  userRelatedGrantUserGroupIds?: IGrantedGroup[];
  // isSyncRevisionToHackmd?: boolean,
  overwriteScopesOfDescendants?: boolean;
};

export type IOptionsForCreate = {
  grant?: PageGrant;
  grantUserGroupIds?: IGrantedGroup[];
  onlyInheritUserRelatedGrantedGroups?: boolean;
  overwriteScopesOfDescendants?: boolean;

  origin?: Origin;
  wip?: boolean;
};

export type IPagePathWithDescendantCount = {
  path: string;
  descendantCount: number;
};
