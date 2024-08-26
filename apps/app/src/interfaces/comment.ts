import type {
  Ref, HasObjectId,
  IPage, IRevision, IUser,
} from '@growi/core';

export type IComment = {
  page: Ref<IPage>,
  creator: Ref<IUser>,
  revision: Ref<IRevision>,
  comment: string;
  commentPosition: number,
  replyTo?: string,
  liker?: Array<Ref<IUser>>,
  createdAt: Date,
  updatedAt: Date,
};

export interface ICommentPostArgs {
  commentForm: {
    comment: string,
    revisionId: string,
    replyTo: string|undefined
  },
  slackNotificationForm: {
    isSlackEnabled: boolean|undefined,
    slackChannels: string|undefined,
  },
}

export type ICommentHasId = IComment & HasObjectId;
export type ICommentHasIdList = ICommentHasId[];
