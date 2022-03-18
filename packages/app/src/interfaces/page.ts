import { Ref, Nullable } from './common';
import { IUser } from './user';
import { IRevision, HasRevisionShortbody } from './revision';
import { ITag } from './tag';
import { HasObjectId } from './has-object-id';
import { SubscriptionStatusType } from './subscription';


export interface IPage {
  path: string,
  status: string,
  revision: Ref<IRevision>,
  tags: Ref<ITag>[],
  creator: Ref<IUser>,
  createdAt: Date,
  updatedAt: Date,
  seenUsers: Ref<IUser>[],
  parent: Ref<IPage> | null,
  descendantCount: number,
  isEmpty: boolean,
  grant: number,
  grantedUsers: Ref<IUser>[],
  grantedGroup: Ref<any>,
  lastUpdateUser: Ref<IUser>,
  liker: Ref<IUser>[],
  commentCount: number
  slackChannels: string,
  pageIdOnHackmd: string,
  revisionHackmdSynced: Ref<IRevision>,
  hasDraftOnHackmd: boolean,
  deleteUser: Ref<IUser>,
  deletedAt: Date,
}

export type IPageHasId = IPage & HasObjectId;

export type IPageForItem = Partial<IPageHasId & {isTarget?: boolean}>;

export type IPageInfo = {
  isV5Compatible: boolean,
  isEmpty: boolean,
  isMovable: boolean,
  isDeletable: boolean,
  isAbleToDeleteCompletely: boolean,
  isRevertible: boolean,
}

export type IPageInfoForEntity = IPageInfo & {
  bookmarkCount?: number,
  sumOfLikers?: number,
  likerIds?: string[],
  sumOfSeenUsers?: number,
  seenUserIds?: string[],
}

export type IPageInfoForOperation = IPageInfoForEntity & {
  isBookmarked?: boolean,
  isLiked?: boolean,
  subscriptionStatus?: SubscriptionStatusType,
}

export type IPageInfoForListing = IPageInfoForEntity & HasRevisionShortbody;

export type IPageInfoAll = IPageInfo | IPageInfoForEntity | IPageInfoForOperation | IPageInfoForListing;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isIPageInfoForEntity = (pageInfo: any | undefined): pageInfo is IPageInfoForEntity => {
  return pageInfo != null && ('isEmpty' in pageInfo) && pageInfo.isEmpty === false;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isIPageInfoForOperation = (pageInfo: any | undefined): pageInfo is IPageInfoForOperation => {
  return pageInfo != null
    && isIPageInfoForEntity(pageInfo)
    && ('isBookmarked' in pageInfo || 'isLiked' in pageInfo || 'subscriptionStatus' in pageInfo);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isIPageInfoForListing = (pageInfo: any | undefined): pageInfo is IPageInfoForListing => {
  return pageInfo != null
    && isIPageInfoForEntity(pageInfo)
    && 'revisionShortBody' in pageInfo;
};

// export type IPageInfoTypeResolver<T extends IPageInfo> =
//   T extends HasRevisionShortbody ? IPageInfoForListing :
//   T extends { isBookmarked?: boolean } | { isLiked?: boolean } | { subscriptionStatus?: SubscriptionStatusType } ? IPageInfoForOperation :
//   T extends { bookmarkCount: number } ? IPageInfoForEntity :
//   T extends { isEmpty: number } ? IPageInfo :
//   T;

/**
 * Union Distribution
 * @param pageInfo
 * @returns
 */
// export const resolvePageInfo = <T extends IPageInfo>(pageInfo: T | undefined): IPageInfoTypeResolver<T> => {
//   return <IPageInfoTypeResolver<T>>pageInfo;
// };

export type IDataWithMeta<D = unknown, M = unknown> = {
  data: D,
  meta?: M,
}

export type IPageWithMeta<M = IPageInfoAll> = IDataWithMeta<IPageHasId, M>;

export type IPageToDeleteWithMeta = IDataWithMeta<HasObjectId & (IPage | { path: string, revision: string }), IPageInfoForEntity | unknown>;
export type IPageToRenameWithMeta = IPageToDeleteWithMeta;

export type IDeleteSinglePageApiv1Result = {
  ok: boolean
  path: string,
  isRecursively: Nullable<true>,
  isCompletely: Nullable<true>,
};

export type IDeleteManyPageApiv3Result = {
  paths: string[],
  isRecursively: Nullable<true>,
  isCompletely: Nullable<true>,
};
