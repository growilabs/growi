import type { IPageHasId, PageGrant } from '@growi/core';

export type AggregatedPage = Pick<
  IPageHasId,
  | '_id'
  | 'path'
  | 'createdAt'
  | 'updatedAt'
  | 'grant'
  | 'grantedUsers'
  | 'grantedGroups'
> & {
  revision: { body: string };
  comments: string[];
  commentsCount: number;
  bookmarksCount: number;
  likeCount: number;
  seenUsersCount: number;
  creator?: {
    username: string;
    email: string;
  };
} & {
  tagNames: string[];
  revisionBodyEmbedded?: number[];
};

export type BulkWriteCommand = {
  index: {
    _index: string;
    _type: '_doc' | undefined;
    _id: string;
  };
};

export type BulkWriteBodyRestriction = {
  grant: PageGrant;
  granted_users?: string[];
  granted_groups: string[];
};

export type BulkWriteBody = {
  path: string;
  created_at: Date;
  updated_at: Date;
  body: string;
  body_embedded?: number[];
  username?: string;
  comments?: string[];
  comment_count: number;
  bookmark_count: number;
  seenUsers_count: number;
  like_count: number;
  tag_names?: string[];
} & BulkWriteBodyRestriction;
