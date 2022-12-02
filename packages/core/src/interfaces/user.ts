import { IAttachment } from './attachment';
import { Ref } from './common';
import { HasObjectId } from './has-object-id';
import { Lang } from './lang';

export type IUser = {
  name: string,
  username: string,
  email: string,
  password: string,
  image?: string, // for backward conpatibility
  imageAttachment?: Ref<IAttachment>,
  imageUrlCached: string,
  isGravatarEnabled: boolean,
  admin: boolean,
  apiToken?: string,
  isEmailPublished: boolean,
  isInvitationEmailSended: boolean,
  lang: Lang,
  slackMemberId?: string,
  createdAt: Date,
  lastLoginAt?: Date,
  introduction: string,
  status: IUserStatus,
}

export type IUserGroupRelation = {
  relatedGroup: Ref<IUserGroup>,
  relatedUser: Ref<IUser>,
  createdAt: Date,
}

export type IUserGroup = {
  name: string;
  createdAt: Date;
  description: string;
  parent: Ref<IUserGroupHasId> | null;
}

export const USER_STATUS = {
  REGISTERED: 1,
  ACTIVE: 2,
  SUSPENDED: 3,
  DELETED: 4,
  INVITED: 5,
} as const;
export type IUserStatus = typeof USER_STATUS[keyof typeof USER_STATUS]

export type IUserHasId = IUser & HasObjectId;
export type IUserGroupHasId = IUserGroup & HasObjectId;
export type IUserGroupRelationHasId = IUserGroupRelation & HasObjectId;

export type IAdminExternalAccount = {
  _id: string,
  providerType: string,
  accountId: string,
  user: IUser,
  createdAt: Date,
}
