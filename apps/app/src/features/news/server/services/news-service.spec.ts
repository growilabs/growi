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

    test('should filter by targetRoles when conditions are set', async () => {
      const userId = new mongoose.Types.ObjectId();

      mocks.newsItemFind.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([]),
      });
      mocks.newsItemCountDocuments.mockResolvedValue(0);
      mocks.newsReadStatusDistinct.mockResolvedValue([]);

      await service.listForUser(userId, ['general'], { limit: 10, offset: 0 });

      const findCall = mocks.newsItemFind.mock.calls[0][0];
      expect(findCall).toMatchObject({
        $or: expect.arrayContaining([
          { 'conditions.targetRoles': { $exists: false } },
          { 'conditions.targetRoles': { $size: 0 } },
          { 'conditions.targetRoles': { $in: ['general'] } },
        ]),
      });
    });

    test('should filter onlyUnread when specified', async () => {
      const userId = new mongoose.Types.ObjectId();
      const readId = new mongoose.Types.ObjectId();
      mocks.newsReadStatusDistinct.mockResolvedValue([readId]);

      mocks.newsItemFind.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue([]),
      });
      mocks.newsItemCountDocuments.mockResolvedValue(0);

      await service.listForUser(userId, ['general'], {
        limit: 10,
        offset: 0,
        onlyUnread: true,
      });

      const findCall = mocks.newsItemFind.mock.calls[0][0];
      expect(findCall).toMatchObject({
        _id: { $nin: [readId] },
      });
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

  describe('getUnreadCount', () => {
    test('should return the number of unread items', async () => {
      const id1 = new mongoose.Types.ObjectId();

      mocks.newsReadStatusDistinct.mockResolvedValue([id1]);
      mocks.newsItemCountDocuments.mockResolvedValue(2);

      const userId = new mongoose.Types.ObjectId();
      const count = await service.getUnreadCount(userId, ['general']);
      expect(count).toBe(2);

      expect(mocks.newsItemCountDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $nin: [id1] },
        }),
      );
    });

    test('should return 0 when all items are read', async () => {
      const id1 = new mongoose.Types.ObjectId();
      const id2 = new mongoose.Types.ObjectId();

      mocks.newsReadStatusDistinct.mockResolvedValue([id1, id2]);
      mocks.newsItemCountDocuments.mockResolvedValue(0);

      const userId = new mongoose.Types.ObjectId();
      const count = await service.getUnreadCount(userId, ['general']);
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
