import type { users } from '~/generated/prisma/client';

/**
 * The comment author as the list API returns it: only the fields the comment
 * UI renders (see the comment spec's design.md, toCommentListItem).
 */
export type ICommentCreatorSummary = Pick<
  users,
  'username' | 'name' | 'imageUrlCached'
> & { _id: string };

export interface ICommentListItem {
  _id: string;
  id: string;
  page: string;
  pageId: string;
  creator: ICommentCreatorSummary | string | null;
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
