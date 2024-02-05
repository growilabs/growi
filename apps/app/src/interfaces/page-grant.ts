import type {
  PageGrant, GroupType, Ref, IUser, IGrantedGroup,
} from '@growi/core';

import { ExternalUserGroupDocument } from '~/features/external-user-group/server/models/external-user-group';
import { UserGroupDocument } from '~/server/models/user-group';

import { IPageGrantData } from './page';


type UserGroupType = typeof GroupType.userGroup;
type ExternalUserGroupType = typeof GroupType.externalUserGroup;
export type PopulatedGrantedGroup = {type: UserGroupType, item: UserGroupDocument } | {type: ExternalUserGroupType, item: ExternalUserGroupDocument }
export type IDataApplicableGroup = {
  applicableGroups?: PopulatedGrantedGroup[]
}

export type IDataApplicableGrant = null | IDataApplicableGroup;
export type IRecordApplicableGrant = Partial<Record<PageGrant, IDataApplicableGrant>>
export type IResApplicableGrant = {
  data?: IRecordApplicableGrant
}
export type IResIsGrantNormalizedGrantData = {
  isForbidden: boolean,
  currentPageGrant: IPageGrantData,
  parentPageGrant?: IPageGrantData
}
export type IResIsGrantNormalized = {
  isGrantNormalized: boolean,
  grantData: IResIsGrantNormalizedGrantData
};

export type IParentGrantData = {
  grant: PageGrant,
  grantedUsers: Ref<IUser>[],
  grantedGroups: IGrantedGroup[],
}
