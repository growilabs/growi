import type { GroupType, PageGrant } from '@growi/core';

import type { ExternalUserGroupDocument } from '~/features/external-user-group/server/models/external-user-group';
import type { UserGroupDocument } from '~/server/models/user-group';

import type { IPageGrantData } from './page';

type UserGroupType = typeof GroupType.userGroup;
type ExternalUserGroupType = typeof GroupType.externalUserGroup;
export type PopulatedGrantedGroup =
  | { type: UserGroupType; item: UserGroupDocument }
  | { type: ExternalUserGroupType; item: ExternalUserGroupDocument };
export type IDataApplicableGroup = {
  applicableGroups?: PopulatedGrantedGroup[];
};

export type IDataApplicableGrant = null | IDataApplicableGroup;
export type IRecordApplicableGrant = Partial<
  Record<PageGrant, IDataApplicableGrant>
>;
export type IResApplicableGrant = {
  data?: IRecordApplicableGrant;
};
export type IResGrantData = {
  isForbidden: boolean;
  currentPageGrant: IPageGrantData;
  parentPageGrant?: IPageGrantData;
};
export type IResCurrentGrantData = {
  isGrantNormalized: boolean;
  grantData: IResGrantData;
};
