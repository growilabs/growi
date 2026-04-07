import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ActivityLogActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';
import userFactory from '~/server/models/user';

import {
  formatDateKey,
  getISOWeekId,
} from '../../utils/contribution-graph-utils';
import { ContributionCache } from '../models/contribution-cache-model';
import { ContributionCacheManager } from './cache-manager';

const createMockId = () => new mongoose.Types.ObjectId().toString();

describe('Contribution Cache Manager Integration Test', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    userFactory(null);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await ContributionCache.deleteMany({});
    const User = mongoose.model('User');
    await User.deleteMany({});
  });

  describe('getUpdatedCache()', () => {
    const cacheManager = new ContributionCacheManager();

    it('should return an array of all combined contribution cache for a user', async () => {
      const userId = createMockId();

      // Set the fixed date
      const mockNow = new Date('2026-04-01T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);

      // Align Test Math with Service Math
      const today = new Date(mockNow);
      const yesterday = new Date(today);
      yesterday.setUTCDate(today.getUTCDate() - 1);

      // The window starts 364 days BEFORE yesterday
      const runner = new Date(yesterday);
      runner.setUTCDate(runner.getUTCDate() - 364);
      const oldestDateInWindow = formatDateKey(runner); // This will now be '2025-04-01'

      const earlyDate = new Date(runner);
      earlyDate.setUTCDate(earlyDate.getUTCDate() + 5);
      const earlyDateStr = formatDateKey(earlyDate);

      const recentDateStr = formatDateKey(yesterday);

      await Activity.create([
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date(recentDateStr),
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date(earlyDateStr),
        },
      ]);

      await ContributionCache.create({
        userId,
        lastUpdated: new Date(earlyDateStr),
        currentWeekData: [{ date: recentDateStr, count: 1 }],
        permanentWeeks: {
          'dynamic-week-id': [{ date: earlyDateStr, count: 1 }],
        },
      });

      // ACT
      const result = await cacheManager.getUpdatedCache(userId);

      expect(result[0].date).toBe(oldestDateInWindow);
      expect(result.length).toBe(365);

      const oldDay = result.find((d) => d.date === earlyDateStr);
      expect(oldDay).toBeDefined();
      expect(oldDay?.count).toBe(1);

      const newDay = result.find((d) => d.date === recentDateStr);
      expect(newDay).toBeDefined();
      expect(newDay?.count).toBe(1);

      vi.useRealTimers();
    });

    it('should remove cache weeks outside range', async () => {
      const userId = createMockId();

      const today = new Date();

      // Start of the 365-day window
      const startDateOfWindow = new Date(today);
      startDateOfWindow.setUTCDate(startDateOfWindow.getUTCDate() - 364);

      // An old date just outside the graph windows
      const outsideDate = new Date(startDateOfWindow);
      outsideDate.setUTCDate(outsideDate.getUTCDate() - 7);
      const outsideDateStr = formatDateKey(outsideDate);
      const weekIdToDelete = getISOWeekId(outsideDate);

      // A recent date
      const newDate = new Date(today);
      newDate.setUTCDate(newDate.getUTCDate() - 7);
      const newDateStr = formatDateKey(newDate);

      await Activity.create([
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date(outsideDateStr),
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date(outsideDateStr),
        },
      ]);

      await ContributionCache.create({
        userId,
        lastUpdated: new Date(newDateStr),
        currentWeekData: [{ date: newDateStr, count: 1 }],
        permanentWeeks: {
          [weekIdToDelete]: [{ date: outsideDateStr, count: 2 }],
        },
      });

      const result = await cacheManager.getUpdatedCache(userId);

      const oldDay = result.find((d) => d.date === outsideDateStr);
      const newDay = result.find((d) => d.date === newDateStr);

      const updatedCache = await ContributionCache.findOne({ userId });
      const hasOldWeekInDb = !!updatedCache?.permanentWeeks?.[weekIdToDelete];

      expect(hasOldWeekInDb).toBe(false);
      expect(result.length).toBe(365);
      expect(oldDay).toBeUndefined();
      expect(newDay).toBeDefined();
    });

    it('should freeze weeks between start of the graph until last week', async () => {
      const userId = createMockId();
      const User = mongoose.model('User');
      await User.create({ _id: userId, status: 2, username: 'testuser' });

      const today = new Date();

      // Date 7 days ago
      const pastDate = new Date(today);
      pastDate.setUTCDate(pastDate.getUTCDate() - 7);
      const pastDateStr = formatDateKey(pastDate);

      await Activity.create([
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date(pastDateStr),
        },
      ]);

      const firstResult = await cacheManager.getUpdatedCache(userId);
      const firstCount = firstResult.find((d) => d.date === pastDateStr)?.count;
      expect(firstCount).toBe(1);

      // Create new activity on the same day
      await Activity.create({
        user: userId,
        action: ActivityLogActions.ACTION_PAGE_UPDATE,
        createdAt: new Date(pastDateStr),
      });

      const secondResult = await cacheManager.getUpdatedCache(userId);
      const secondCount = secondResult.find(
        (d) => d.date === pastDateStr,
      )?.count;

      expect(secondCount).toBe(1);
    });

    it('should throw error if user and contribution cache doesnt exist', async () => {
      const userId = createMockId();

      const newDate = new Date();
      newDate.setUTCDate(newDate.getUTCDate() - 7);

      await expect(cacheManager.getUpdatedCache(userId)).rejects.toThrowError(
        'User does not exist.',
      );
    });

    it('should return contribution cache if user exists', async () => {
      const userId = createMockId();
      const User = mongoose.model('User');
      await User.create({ _id: userId, status: 2, username: 'testuser' });

      const newDate = new Date();
      newDate.setUTCDate(newDate.getUTCDate() - 7);
      const newDateStr = formatDateKey(newDate);

      await ContributionCache.create({
        userId,
        lastUpdated: new Date(newDateStr),
        currentWeekData: [],
        permanentWeeks: {
          weekId: [],
        },
      });

      const result = await cacheManager.getUpdatedCache(userId);

      expect(result).toHaveLength(365);
      expect(result[0]).toHaveProperty('date');
      expect(result[0]).toHaveProperty('count');
    });

    it('should return contribution cache if user exists but no contribution cache exist', async () => {
      const userId = createMockId();
      const User = mongoose.model('User');
      await User.create({ _id: userId, status: 2, username: 'testuser' });

      const result = await cacheManager.getUpdatedCache(userId);

      expect(result).toHaveLength(365);
      expect(result[0]).toHaveProperty('date');
      expect(result[0]).toHaveProperty('count');
    });

    it('should transition currentWeekData to permanentWeeks when the week shifts to Monday', async () => {
      // Setup predictable time (Wednesday)
      const mockNow = new Date('2026-03-25T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);

      const userId = createMockId();
      const User = mongoose.model('User');
      await User.create({ _id: userId, status: 2, username: 'week-tester' });

      // Setup Relative Dates based on the mocked now date
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setUTCDate(now.getUTCDate() - 1);
      const lastWeekDate = new Date(now);
      lastWeekDate.setUTCDate(now.getUTCDate() - 7);

      const todayStr = formatDateKey(now);
      const lastWeekDateStr = formatDateKey(lastWeekDate);
      const lastWeekId = getISOWeekId(lastWeekDate);

      await ContributionCache.create({
        userId,
        lastUpdated: yesterday, // Tuesday
        currentWeekData: [{ date: lastWeekDateStr, count: 5 }],
        permanentWeeks: new Map(),
      });

      // Create Activity for Today (Wednesday)
      await Activity.create({
        user: userId,
        action: ActivityLogActions.ACTION_PAGE_CREATE,
        createdAt: now,
      });

      await cacheManager.getUpdatedCache(userId);

      const updatedDoc = await ContributionCache.findOne({ userId });

      // March 18th data should have been moved to permanentWeeks
      const archivedWeek = updatedDoc?.permanentWeeks.get(lastWeekId);
      expect(archivedWeek).toBeDefined();
      expect(archivedWeek?.find((d) => d.date === lastWeekDateStr)?.count).toBe(
        5,
      );

      // March 25th data should be in the fresh currentWeekData
      const todayEntry = updatedDoc?.currentWeekData.find(
        (d) => d.date === todayStr,
      );
      expect(todayEntry?.count).toBe(1);

      vi.useRealTimers();
    });

    it('should return exactly 365 days and exclude today from the results', async () => {
      const userId = createMockId();
      const User = mongoose.model('User');
      await User.create({
        _id: userId,
        status: 2,
        username: 'boundary-tester',
      });

      // Freeze Time (March 25, 2026)
      const today = new Date('2026-03-25T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(today);

      const yesterday = new Date(today);
      yesterday.setUTCDate(today.getUTCDate() - 1);

      // Create activities: One inside the window, one outside
      await Activity.create([
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: yesterday, // Should be visible
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: today, // Should be HIDDEN per business logic
        },
      ]);

      const result = await cacheManager.getUpdatedCache(userId);

      const activeDays = result.filter((day) => day.count > 0);

      expect(result).toHaveLength(365);

      expect(activeDays).toHaveLength(1);
      expect(activeDays[0].date).toBe('2026-03-24');

      vi.useRealTimers();
    });

    it('should maintain a 365-day window and handle data rotation when the graph is full', async () => {
      const userId = createMockId();

      // Setup Dates: Today vs. 370 days ago (Older than the graph limit)
      const now = new Date();
      now.setUTCHours(12, 0, 0, 0);

      const wayPastDate = new Date(now);
      wayPastDate.setUTCDate(now.getUTCDate() - 370); // Out of bounds

      const justInsideDate = new Date(now);
      justInsideDate.setUTCDate(now.getUTCDate() - 360); // In bounds

      const wayPastId = getISOWeekId(wayPastDate);
      const justInsideId = getISOWeekId(justInsideDate);
      const wayPastStr = formatDateKey(wayPastDate);

      vi.useFakeTimers();
      vi.setSystemTime(now);

      // Setup Cache with a "Stale" week and a "Valid" week
      await ContributionCache.create({
        userId,
        lastUpdated: new Date(now.getTime() - 86400000), // Updated yesterday
        currentWeekData: [],
        permanentWeeks: new Map([
          [wayPastId, [{ date: wayPastStr, count: 10 }]], // This should be cleaned
          [justInsideId, [{ date: formatDateKey(justInsideDate), count: 5 }]],
        ]),
      });

      await Activity.create({
        user: userId,
        action: ActivityLogActions.ACTION_PAGE_CREATE,
        createdAt: now,
      });

      await cacheManager.getUpdatedCache(userId);

      const updatedDoc = await ContributionCache.findOne({ userId });

      expect(updatedDoc?.permanentWeeks.has(justInsideId)).toBe(true);
      expect(updatedDoc?.permanentWeeks.has(wayPastId)).toBe(false);
      expect(updatedDoc?.permanentWeeks.size).toBeLessThanOrEqual(53);

      const todayEntry = updatedDoc?.currentWeekData.find(
        (d) => d.date === formatDateKey(now),
      );
      expect(todayEntry?.count).toBe(1);

      vi.useRealTimers();
    });
  });
});
