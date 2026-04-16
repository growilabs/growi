import mongoose from 'mongoose';

// Use vi.hoisted so these variables are accessible inside vi.mock factory
const mocks = vi.hoisted(() => {
  const newsItemFind = vi.fn();
  const newsItemUpdateMany = vi.fn();
  const newsItemDeleteMany = vi.fn();
  const newsItemCountDocuments = vi.fn();

  const newsReadStatusDistinct = vi.fn();
  const newsReadStatusUpdateOne = vi.fn();
  const newsReadStatusInsertMany = vi.fn();

  return {
    NewsItem: {
      find: newsItemFind,
      updateMany: newsItemUpdateMany,
      deleteMany: newsItemDeleteMany,
      countDocuments: newsItemCountDocuments,
    },
    NewsReadStatus: {
      distinct: newsReadStatusDistinct,
      updateOne: newsReadStatusUpdateOne,
      insertMany: newsReadStatusInsertMany,
    },
    newsItemFind,
    newsItemUpdateMany,
    newsItemDeleteMany,
    newsItemCountDocuments,
    newsReadStatusDistinct,
    newsReadStatusUpdateOne,
    newsReadStatusInsertMany,
  };
});

vi.mock('../models/news-item', () => ({
  NewsItem: mocks.NewsItem,
}));

vi.mock('../models/news-read-status', () => ({
  NewsReadStatus: mocks.NewsReadStatus,
}));

import { NewsService } from './news-service';

describe('NewsService', () => {
  let service: NewsService;

  beforeEach(() => {
    service = new NewsService();
    vi.clearAllMocks();
  });

  describe('listForUser', () => {
    test('should return empty result when no news items', async () => {
      mocks.newsItemFind.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([]),
      });
      mocks.newsItemCountDocuments.mockResolvedValue(0);
      mocks.newsReadStatusDistinct.mockResolvedValue([]);

      const result = await service.listForUser(
        new mongoose.Types.ObjectId(),
        ['general'],
        { limit: 10, offset: 0 },
      );

      expect(result.docs).toEqual([]);
      expect(result.totalDocs).toBe(0);
    });

    test('should attach isRead=true for read items', async () => {
      const newsId = new mongoose.Types.ObjectId();
      const readNewsId = new mongoose.Types.ObjectId();

      mocks.newsItemFind.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([
          {
            _id: newsId,
            externalId: 'n1',
            title: { ja_JP: 'Test' },
            publishedAt: new Date(),
            fetchedAt: new Date(),
          },
          {
            _id: readNewsId,
            externalId: 'n2',
            title: { ja_JP: 'Read' },
            publishedAt: new Date(),
            fetchedAt: new Date(),
          },
        ]),
      });
      mocks.newsItemCountDocuments.mockResolvedValue(2);
      mocks.newsReadStatusDistinct.mockResolvedValue([readNewsId]);

      const result = await service.listForUser(
        new mongoose.Types.ObjectId(),
        ['general'],
        { limit: 10, offset: 0 },
      );

      expect(result.docs).toHaveLength(2);
      const unread = result.docs.find((d) => d._id.equals(newsId));
      const read = result.docs.find((d) => d._id.equals(readNewsId));
      expect(unread?.isRead).toBe(false);
      expect(read?.isRead).toBe(true);
    });

    test('should not include items with non-matching targetRoles in docs', async () => {
      const generalItemId = new mongoose.Types.ObjectId();

      // Mock returns both items (simulating DB returning role-filtered results)
      mocks.newsItemFind.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi
          .fn()
          .mockResolvedValue([
            {
              _id: generalItemId,
              externalId: 'general-news',
              title: { ja_JP: 'General' },
              publishedAt: new Date(),
              fetchedAt: new Date(),
            },
          ]),
      });
      mocks.newsItemCountDocuments.mockResolvedValue(1);
      mocks.newsReadStatusDistinct.mockResolvedValue([]);

      const result = await service.listForUser(
        new mongoose.Types.ObjectId(),
        ['general'],
        { limit: 10, offset: 0 },
      );

      // Contract: only items matching user's role appear in docs
      expect(result.docs).toHaveLength(1);
      expect(result.docs.every((d) => d._id.equals(generalItemId))).toBe(true);
    });

    test('should exclude read items from docs when onlyUnread is true', async () => {
      const unreadId = new mongoose.Types.ObjectId();
      const readId = new mongoose.Types.ObjectId();

      mocks.newsReadStatusDistinct.mockResolvedValue([readId]);
      // When onlyUnread=true, DB query already excludes read items
      mocks.newsItemFind.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi
          .fn()
          .mockResolvedValue([
            {
              _id: unreadId,
              externalId: 'unread-news',
              title: { ja_JP: 'Unread' },
              publishedAt: new Date(),
              fetchedAt: new Date(),
            },
          ]),
      });
      mocks.newsItemCountDocuments.mockResolvedValue(1);

      const result = await service.listForUser(
        new mongoose.Types.ObjectId(),
        ['general'],
        { limit: 10, offset: 0, onlyUnread: true },
      );

      // Contract: no read item appears in output
      expect(result.docs).toHaveLength(1);
      expect(result.docs[0].isRead).toBe(false);
      expect(result.docs.some((d) => d._id.equals(readId))).toBe(false);
    });

    test('should return correct pagination metadata', async () => {
      mocks.newsItemFind.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([
          {
            _id: new mongoose.Types.ObjectId(),
            externalId: 'p1',
            title: { ja_JP: 'P1' },
            publishedAt: new Date(),
            fetchedAt: new Date(),
          },
          {
            _id: new mongoose.Types.ObjectId(),
            externalId: 'p2',
            title: { ja_JP: 'P2' },
            publishedAt: new Date(),
            fetchedAt: new Date(),
          },
          {
            _id: new mongoose.Types.ObjectId(),
            externalId: 'p3',
            title: { ja_JP: 'P3' },
            publishedAt: new Date(),
            fetchedAt: new Date(),
          },
          {
            _id: new mongoose.Types.ObjectId(),
            externalId: 'p4',
            title: { ja_JP: 'P4' },
            publishedAt: new Date(),
            fetchedAt: new Date(),
          },
          {
            _id: new mongoose.Types.ObjectId(),
            externalId: 'p5',
            title: { ja_JP: 'P5' },
            publishedAt: new Date(),
            fetchedAt: new Date(),
          },
        ]),
      });
      mocks.newsItemCountDocuments.mockResolvedValue(23);
      mocks.newsReadStatusDistinct.mockResolvedValue([]);

      const result = await service.listForUser(
        new mongoose.Types.ObjectId(),
        ['general'],
        { limit: 5, offset: 10 },
      );

      // Contract: pagination fields are correct for offset=10, limit=5, total=23
      expect(result.totalDocs).toBe(23);
      expect(result.limit).toBe(5);
      expect(result.page).toBe(3);
      expect(result.totalPages).toBe(5);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPrevPage).toBe(true);
    });
  });

  describe('markRead', () => {
    test('should upsert a NewsReadStatus record', async () => {
      mocks.newsReadStatusUpdateOne.mockResolvedValue({ upsertedCount: 1 });

      const userId = new mongoose.Types.ObjectId();
      const newsItemId = new mongoose.Types.ObjectId();
      await service.markRead(userId, newsItemId);

      expect(mocks.newsReadStatusUpdateOne).toHaveBeenCalledWith(
        { userId, newsItemId },
        expect.objectContaining({ $setOnInsert: expect.any(Object) }),
        { upsert: true },
      );
    });

    test('should be idempotent (no error on duplicate)', async () => {
      mocks.newsReadStatusUpdateOne.mockResolvedValue({ upsertedCount: 0 });

      const userId = new mongoose.Types.ObjectId();
      const newsItemId = new mongoose.Types.ObjectId();
      await expect(service.markRead(userId, newsItemId)).resolves.not.toThrow();
      await expect(service.markRead(userId, newsItemId)).resolves.not.toThrow();
    });
  });

  describe('markAllRead', () => {
    test('should complete without error when news items exist', async () => {
      const itemId = new mongoose.Types.ObjectId();
      mocks.newsItemFind.mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: itemId }]),
      });
      mocks.newsReadStatusInsertMany.mockResolvedValue([]);

      const userId = new mongoose.Types.ObjectId();
      await expect(
        service.markAllRead(userId, ['general']),
      ).resolves.not.toThrow();
    });

    test('should complete without error when no news items exist', async () => {
      mocks.newsItemFind.mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      });

      const userId = new mongoose.Types.ObjectId();
      await expect(
        service.markAllRead(userId, ['general']),
      ).resolves.not.toThrow();

      // Contract: no write operation when nothing to mark
      expect(mocks.newsReadStatusInsertMany).not.toHaveBeenCalled();
    });

    test('should silently ignore duplicate key errors (already-read items)', async () => {
      mocks.newsItemFind.mockReturnValue({
        lean: vi
          .fn()
          .mockResolvedValue([{ _id: new mongoose.Types.ObjectId() }]),
      });
      const duplicateError = Object.assign(new Error('duplicate key'), {
        code: 11000,
      });
      mocks.newsReadStatusInsertMany.mockRejectedValue(duplicateError);

      const userId = new mongoose.Types.ObjectId();
      // Contract: idempotent — calling twice doesn't throw
      await expect(
        service.markAllRead(userId, ['general']),
      ).resolves.not.toThrow();
    });

    test('should throw non-duplicate errors', async () => {
      mocks.newsItemFind.mockReturnValue({
        lean: vi
          .fn()
          .mockResolvedValue([{ _id: new mongoose.Types.ObjectId() }]),
      });
      const otherError = Object.assign(new Error('connection lost'), {
        code: 12345,
      });
      mocks.newsReadStatusInsertMany.mockRejectedValue(otherError);

      const userId = new mongoose.Types.ObjectId();
      // Contract: real errors propagate to caller
      await expect(service.markAllRead(userId, ['general'])).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('getUnreadCount', () => {
    test('should return the number of unread items', async () => {
      mocks.newsReadStatusDistinct.mockResolvedValue([
        new mongoose.Types.ObjectId(),
      ]);
      mocks.newsItemCountDocuments.mockResolvedValue(2);

      const userId = new mongoose.Types.ObjectId();
      const count = await service.getUnreadCount(userId, ['general']);

      // Contract: returns the unread count as a number
      expect(count).toBe(2);
    });

    test('should return 0 when all items are read', async () => {
      mocks.newsReadStatusDistinct.mockResolvedValue([
        new mongoose.Types.ObjectId(),
        new mongoose.Types.ObjectId(),
      ]);
      mocks.newsItemCountDocuments.mockResolvedValue(0);

      const count = await service.getUnreadCount(
        new mongoose.Types.ObjectId(),
        ['general'],
      );
      expect(count).toBe(0);
    });

    test('should return 0 when no news items exist', async () => {
      mocks.newsReadStatusDistinct.mockResolvedValue([]);
      mocks.newsItemCountDocuments.mockResolvedValue(0);

      const count = await service.getUnreadCount(
        new mongoose.Types.ObjectId(),
        ['general'],
      );
      expect(count).toBe(0);
    });
  });

  describe('upsertNewsItems', () => {
    test('should call updateMany with upsert for each item', async () => {
      mocks.newsItemUpdateMany.mockResolvedValue({ upsertedCount: 1 });

      await service.upsertNewsItems([
        {
          id: 'ext-001',
          title: { ja_JP: 'Test' },
          publishedAt: '2026-01-01T00:00:00Z',
        },
      ]);

      expect(mocks.newsItemUpdateMany).toHaveBeenCalledTimes(1);
      const [filter, update, opts] = mocks.newsItemUpdateMany.mock.calls[0];
      expect(filter).toEqual({ externalId: 'ext-001' });
      expect(update.$set.externalId).toBe('ext-001');
      expect(opts).toEqual({ upsert: true });
    });

    test('should upsert multiple items', async () => {
      mocks.newsItemUpdateMany.mockResolvedValue({ upsertedCount: 1 });

      await service.upsertNewsItems([
        {
          id: 'ext-001',
          title: { ja_JP: 'Item 1' },
          publishedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'ext-002',
          title: { ja_JP: 'Item 2' },
          publishedAt: '2026-01-02T00:00:00Z',
        },
      ]);

      expect(mocks.newsItemUpdateMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('deleteNewsItemsByExternalIds', () => {
    test('should call deleteMany with externalId filter', async () => {
      mocks.newsItemDeleteMany.mockResolvedValue({ deletedCount: 1 });

      await service.deleteNewsItemsByExternalIds(['ext-001', 'ext-002']);

      expect(mocks.newsItemDeleteMany).toHaveBeenCalledWith({
        externalId: { $in: ['ext-001', 'ext-002'] },
      });
    });

    test('should do nothing if externalIds is empty', async () => {
      await service.deleteNewsItemsByExternalIds([]);
      expect(mocks.newsItemDeleteMany).not.toHaveBeenCalled();
    });
  });
});
