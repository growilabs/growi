import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

import {
  InvalidSearchHistoryKeywordError,
  listSearchHistories,
  recordSearchHistory,
  removeAllSearchHistoriesOfUser,
  SEARCH_HISTORY_RETENTION_LIMIT,
} from './search-history';

const INDEX_NAME = 'user_1_keyword_1';

// Rows are seeded with distinct past timestamps so ordering never depends on
// two records landing in the same millisecond.
const minutesAgo = (minutes: number): Date =>
  new Date(Date.now() - minutes * 60_000);

describe('search-history service', () => {
  const userIds: string[] = [];

  const newUserId = (): string => {
    const userId = new ObjectId().toString();
    userIds.push(userId);
    return userId;
  };

  const seed = async (
    userId: string,
    keywords: readonly string[],
  ): Promise<void> => {
    // keywords[0] is the newest
    await prisma.searchhistories.createMany({
      data: keywords.map((keyword, i) => ({
        userId,
        keyword,
        lastSearchedAt: minutesAgo(i + 1),
      })),
    });
  };

  const countOf = (userId: string): Promise<number> =>
    prisma.searchhistories.count({ where: { userId } });

  afterAll(async () => {
    await prisma.searchhistories.deleteMany({
      where: { userId: { in: userIds } },
    });
  });

  it('runs against the unique (user, keyword) index', async () => {
    const indexes = await mongoose.connection
      .collection('searchhistories')
      .indexes();

    expect(indexes.find((i) => i.name === INDEX_NAME)).toMatchObject({
      key: { user: 1, keyword: 1 },
      unique: true,
    });
  });

  describe('recordSearchHistory', () => {
    it('stores a new keyword trimmed and returns it as a list item without userId', async () => {
      const userId = newUserId();

      const recorded = await recordSearchHistory(userId, '  wiki  search ');

      expect(Object.keys(recorded).sort()).toEqual([
        '_id',
        'keyword',
        'lastSearchedAt',
      ]);
      expect(recorded.keyword).toBe('wiki  search');
      expect(recorded.lastSearchedAt).toBeInstanceOf(Date);
      expect(await listSearchHistories(userId)).toEqual([recorded]);
    });

    it('re-recording an existing keyword moves it to the top keeping its id and the count', async () => {
      const userId = newUserId();
      await seed(userId, ['newest', 'middle', 'oldest']);
      const before = await listSearchHistories(userId);
      const oldest = before[2];

      const recorded = await recordSearchHistory(userId, 'oldest');

      const after = await listSearchHistories(userId);
      expect(after.map((h) => h.keyword)).toEqual([
        'oldest',
        'newest',
        'middle',
      ]);
      expect(recorded._id).toBe(oldest._id);
      expect(after[0]._id).toBe(oldest._id);
      expect(await countOf(userId)).toBe(3);
    });

    it('treats keywords differing only in case as separate entries', async () => {
      const userId = newUserId();

      const upper = await recordSearchHistory(userId, 'Foo');
      const lower = await recordSearchHistory(userId, 'foo');

      expect(upper._id).not.toBe(lower._id);
      expect(
        (await listSearchHistories(userId)).map((h) => h.keyword).sort(),
      ).toEqual(['Foo', 'foo']);
    });

    it('removes the oldest entry when the 51st keyword is recorded', async () => {
      const userId = newUserId();
      const keywords = Array.from(
        { length: SEARCH_HISTORY_RETENTION_LIMIT },
        (_, i) => `keyword-${i}`,
      );
      await seed(userId, keywords);
      const oldestKeyword = keywords[keywords.length - 1];

      await recordSearchHistory(userId, 'brand-new');

      const after = await listSearchHistories(userId);
      expect(SEARCH_HISTORY_RETENTION_LIMIT).toBe(50);
      expect(after).toHaveLength(50);
      expect(await countOf(userId)).toBe(50);
      expect(after[0].keyword).toBe('brand-new');
      expect(after.map((h) => h.keyword)).not.toContain(oldestKeyword);
      expect(after.map((h) => h.keyword)).toContain(
        keywords[keywords.length - 2],
      );
    });

    it('re-recording an existing keyword at exactly the limit removes nothing', async () => {
      const userId = newUserId();
      const keywords = Array.from(
        { length: SEARCH_HISTORY_RETENTION_LIMIT },
        (_, i) => `keyword-${i}`,
      );
      await seed(userId, keywords);
      const oldestKeyword = keywords[keywords.length - 1];

      await recordSearchHistory(userId, oldestKeyword);

      const after = await listSearchHistories(userId);
      expect(after[0].keyword).toBe(oldestKeyword);
      expect(after.map((h) => h.keyword).sort()).toEqual([...keywords].sort());
    });

    it("trimming one user's history leaves other users' entries intact", async () => {
      const userId = newUserId();
      const otherUserId = newUserId();
      await seed(
        userId,
        Array.from(
          { length: SEARCH_HISTORY_RETENTION_LIMIT },
          (_, i) => `keyword-${i}`,
        ),
      );
      // Older than every entry of userId, so they would be the first to go
      // if the trim crossed users.
      const otherKeywords = ['other-0', 'other-1', 'other-2'];
      await prisma.searchhistories.createMany({
        data: otherKeywords.map((keyword, i) => ({
          userId: otherUserId,
          keyword,
          lastSearchedAt: minutesAgo(SEARCH_HISTORY_RETENTION_LIMIT + 10 + i),
        })),
      });

      await recordSearchHistory(userId, 'brand-new');

      expect(await countOf(userId)).toBe(SEARCH_HISTORY_RETENTION_LIMIT);
      expect(
        (await listSearchHistories(otherUserId)).map((h) => h.keyword),
      ).toEqual(otherKeywords);
    });

    it.each([
      ['blank', '   '],
      ['201 code points', '🍣'.repeat(201)],
    ])('rejects a %s keyword with InvalidSearchHistoryKeywordError and writes nothing', async (_, keyword) => {
      const userId = newUserId();

      await expect(recordSearchHistory(userId, keyword)).rejects.toBeInstanceOf(
        InvalidSearchHistoryKeywordError,
      );
      expect(await countOf(userId)).toBe(0);
    });

    it('settles concurrent records of the same keyword into a single entry', async () => {
      const userId = newUserId();

      const results = await Promise.all(
        Array.from({ length: 5 }, () => recordSearchHistory(userId, 'same')),
      );

      expect(new Set(results.map((r) => r._id)).size).toBe(1);
      expect(await countOf(userId)).toBe(1);
    });
  });

  describe('listSearchHistories', () => {
    it("returns only the user's own entries, newest first", async () => {
      const userId = newUserId();
      const otherUserId = newUserId();
      await seed(userId, ['a', 'b', 'c']);
      await seed(otherUserId, ['other']);

      const histories = await listSearchHistories(userId);

      expect(histories.map((h) => h.keyword)).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty list for a user without history', async () => {
      expect(await listSearchHistories(newUserId())).toEqual([]);
    });
  });

  describe('removeAllSearchHistoriesOfUser', () => {
    it("removes only the user's own entries", async () => {
      const userId = newUserId();
      const otherUserId = newUserId();
      await seed(userId, ['a', 'b']);
      await seed(otherUserId, ['a']);

      await removeAllSearchHistoriesOfUser(userId);

      expect(await countOf(userId)).toBe(0);
      expect(
        (await listSearchHistories(otherUserId)).map((h) => h.keyword),
      ).toEqual(['a']);
    });
  });
});
