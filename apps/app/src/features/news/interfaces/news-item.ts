import type { Types } from 'mongoose';

export interface INewsItem {
  externalId: string;
  title: Record<string, string>;
  body?: Record<string, string>;
  /**
   * Rendering format of `body`. `'markdown'` opts into Markdown rendering on
   * /_news; any other/absent value renders as plain text. Typed as `string`
   * (not the literal `'markdown'`) so an unknown future value survives ingest
   * and degrades to plain text instead of dropping the item.
   */
  bodyFormat?: string;
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
  bodyFormat?: string;
  emoji?: string;
  url?: string;
  publishedAt: string | Date;
  conditions?: {
    targetRoles?: string[];
  };
}
