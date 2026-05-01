import type { Types } from 'mongoose';

import type { PaginateResult } from '~/interfaces/in-app-notification';
import loggerFactory from '~/utils/logger';

import type {
  INewsItemInput,
  INewsItemWithReadStatus,
} from '../../interfaces/news-item';
import { NewsItem } from '../models/news-item';
import { NewsReadStatus } from '../models/news-read-status';

const logger = loggerFactory('growi:feature:news:service');

/**
 * Build role filter query for NewsItem
 */
const buildRoleFilter = (userRoles: string[]) => ({
  $or: [
    { 'conditions.targetRoles': { $exists: false } },
    { 'conditions.targetRoles': { $size: 0 } },
    { 'conditions.targetRoles': { $in: userRoles } },
  ],
});

export class NewsService {
  /**
   * List news items for a user with role filter and read status
   */
  async listForUser(
    userId: Types.ObjectId,
    userRoles: string[],
    options: { limit: number; offset: number; onlyUnread?: boolean },
  ): Promise<PaginateResult<INewsItemWithReadStatus>> {
    const { limit, offset, onlyUnread = false } = options;

    const roleFilter = buildRoleFilter(userRoles);

    // Get read item IDs for this user
    const readItemIds = await NewsReadStatus.distinct('newsItemId', { userId });

    const query: Record<string, unknown> = { ...roleFilter };
    if (onlyUnread) {
      query._id = { $nin: readItemIds };
    }

    const [items, totalDocs] = await Promise.all([
      NewsItem.find(query)
        .sort({ publishedAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      NewsItem.countDocuments(query),
    ]);

    const readIdSet = new Set(readItemIds.map((id) => id.toString()));

    const docs: INewsItemWithReadStatus[] = items.map((item) => ({
      ...item,
      isRead: readIdSet.has(item._id.toString()),
    }));

    const totalPages = Math.ceil(totalDocs / limit) || 1;
    const page = Math.floor(offset / limit) + 1;

    return {
      docs,
      totalDocs,
      limit,
      offset,
      page,
      pagingCounter: offset + 1,
      hasPrevPage: page > 1,
      hasNextPage: page < totalPages,
      prevPage: page > 1 ? page - 1 : null,
      nextPage: page < totalPages ? page + 1 : null,
      totalPages,
    };
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(
    userId: Types.ObjectId,
    userRoles: string[],
  ): Promise<number> {
    const roleFilter = buildRoleFilter(userRoles);

    const readItemIds = await NewsReadStatus.distinct('newsItemId', { userId });

    return NewsItem.countDocuments({
      ...roleFilter,
      _id: { $nin: readItemIds },
    });
  }

  /**
   * Mark a single news item as read (idempotent)
   */
  async markRead(
    userId: Types.ObjectId,
    newsItemId: Types.ObjectId,
  ): Promise<void> {
    await NewsReadStatus.updateOne(
      { userId, newsItemId },
      { $setOnInsert: { userId, newsItemId, readAt: new Date() } },
      { upsert: true },
    );
  }

  /**
   * Mark all news items as read for the user (filtered by role)
   */
  async markAllRead(
    userId: Types.ObjectId,
    userRoles: string[],
  ): Promise<void> {
    const roleFilter = buildRoleFilter(userRoles);
    const items = await NewsItem.find(roleFilter).lean();

    if (items.length === 0) return;

    const now = new Date();
    const statusDocs = items.map((item) => ({
      userId,
      newsItemId: item._id,
      readAt: now,
    }));

    try {
      await NewsReadStatus.insertMany(statusDocs, { ordered: false });
    } catch (err: unknown) {
      // Ignore duplicate key errors (already read items) — ordered: false continues on duplicates
      if ((err as { code?: number }).code !== 11000) {
        logger.error({ err }, 'markAllRead failed');
        throw err;
      }
    }
  }

  /**
   * Upsert news items from feed (keyed by externalId)
   */
  async upsertNewsItems(items: INewsItemInput[]): Promise<void> {
    if (items.length === 0) return;

    const now = new Date();

    await NewsItem.bulkWrite(
      items.map((item) => ({
        updateOne: {
          filter: { externalId: item.id },
          update: {
            $set: {
              externalId: item.id,
              title: item.title,
              body: item.body,
              emoji: item.emoji,
              url: item.url,
              publishedAt: new Date(item.publishedAt),
              fetchedAt: now,
              conditions: item.conditions,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  /**
   * Delete news items that are no longer in the feed
   */
  async deleteNewsItemsByExternalIds(externalIds: string[]): Promise<void> {
    if (externalIds.length === 0) return;

    await NewsItem.deleteMany({ externalId: { $in: externalIds } });
  }

  /**
   * Delete every cached news item whose externalId is NOT in the supplied set.
   * Caller passes the full list of externalIds present in the latest feed; any DB
   * item missing from that list is considered stale and removed (Requirement 1.3).
   *
   * Note: passing an empty array means "feed has no items" and will delete every
   * cached news item. Callers must only invoke this after a successful feed fetch.
   */
  async deleteItemsNotInFeed(feedExternalIds: string[]): Promise<void> {
    await NewsItem.deleteMany({ externalId: { $nin: feedExternalIds } });
  }
}
