import type { Types } from 'mongoose';

/**
 * News image resolved at ingest time. `url` is an absolute URL that has
 * already passed containment validation (see resolve-image-url.ts);
 * `alt` is a locale-keyed map like title/body.
 */
export interface INewsItemImage {
  url: string;
  alt?: Record<string, string>;
}

export interface INewsItem {
  externalId: string;
  title: Record<string, string>;
  body?: Record<string, string>;
  emoji?: string;
  url?: string;
  image?: INewsItemImage;
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
  /** Already resolved + containment-validated by the cron (never a raw feed path) */
  image?: INewsItemImage;
  publishedAt: string | Date;
  conditions?: {
    targetRoles?: string[];
  };
}
