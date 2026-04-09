import type { Types } from 'mongoose';

export interface INewsItem {
  externalId: string;
  title: Record<string, string>;
  body?: Record<string, string>;
  emoji?: string;
  url?: string;
  publishedAt: Date;
  fetchedAt: Date;
  conditions?: {
    targetRoles?: string[];
  };
}

export interface INewsItemHasId extends INewsItem {
  _id: Types.ObjectId;
}

export interface INewsItemWithReadStatus extends INewsItemHasId {
  isRead: boolean;
}

export interface INewsItemInput {
  id: string;
  title: Record<string, string>;
  body?: Record<string, string>;
  emoji?: string;
  url?: string;
  publishedAt: string | Date;
  conditions?: {
    targetRoles?: string[];
  };
}
