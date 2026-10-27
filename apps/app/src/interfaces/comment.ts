import type { HasObjectId, IPage, IRevision, IUser, Ref } from '@growi/core';

import type { ICommentCreatorSummary } from '~/features/comment/interfaces';

export type IComment = {
  page: Ref<IPage>;
  creator: Ref<IUser> | ICommentCreatorSummary | null;
  revision: Ref<IRevision> | null;
  comment: string;
  commentPosition: number;
  replyTo?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface ICommentPostArgs {
  commentForm: {
    comment: string;
    revisionId: string;
    replyTo: string | undefined;
  };
  slackNotificationForm: {
    isSlackEnabled: boolean | undefined;
    slackChannels: string | undefined;
  };
}

export type ICommentHasId = IComment & HasObjectId;
export type ICommentHasIdList = ICommentHasId[];
