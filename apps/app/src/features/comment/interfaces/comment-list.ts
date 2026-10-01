import type { users } from '~/generated/prisma/client';

/** A user row without credentials; `email` is present only when the user publishes it. */
export type ICommentCreator = Omit<users, 'password' | 'apiToken' | 'email'> & {
  email?: string | null;
};

export interface ICommentListItem {
  _id: string;
  id: string;
  page: string;
  pageId: string;
  creator: ICommentCreator | string | null;
  creatorId: string | null;
  revision: string | null;
  revisionId: string | null;
  replyTo: string | null;
  replyToId: string | null;
  comment: string;
  commentPosition: number;
  createdAt: Date;
  updatedAt: Date;
  isInline: boolean;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  approxOffset: number | null;
  anchorOriginRevisionId: string | null;
  resolvedById: string | null;
  resolvedAt: Date | null;
}

export interface ListCommentsRequestQuery {
  pageId: string;
  revisionId?: string;
  shareLinkId?: string;
}

export interface ListCommentsResponseBody {
  comments: ICommentListItem[];
}
