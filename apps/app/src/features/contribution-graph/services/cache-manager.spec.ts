import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ActivityLogActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';

import { ContributionCache } from '../models/contribution-cache-model';
import { formatDateKey, getISOWeekId } from '../utils/contribution-graph-utils';
import { ContributionCacheManager } from './cache-manager';

const createMockId = () => new mongoose.Types.ObjectId().toString();

describe('Contribution Cache Manager Integration Test', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await ContributionCache.deleteMany({});
  });

  describe('getUpdatedCache()', () => {
    const cacheManager = new ContributionCacheManager();

    it('should return an array of all combined contribution cache for a user', async () => {
      const userId = createMockId();

      const today = new Date();

      // Start of the 365-day window
      const runner = new Date(today);
      runner.setUTCDate(runner.getUTCDate() - 364);
      const oldestDateInWindow = formatDateKey(runner);

      // A date near the beginning of the window
      const earlyDate = new Date(runner);
      earlyDate.setUTCDate(earlyDate.getUTCDate() + 5);
      const earlyDateStr = formatDateKey(earlyDate);

      // A date near the end of the window
      const recentDate = new Date(today);
      recentDate.setUTCDate(recentDate.getUTCDate() - 1);
      const recentDateStr = formatDateKey(recentDate);

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

      const result = await cacheManager.getUpdatedCache(userId);

      expect(result[0].date).toBe(oldestDateInWindow);
      expect(result.length).toBe(365);

      const oldDay = result.find((d) => d.date === earlyDateStr);
      expect(oldDay).toBeDefined();
      expect(oldDay?.count).toBe(1);

      const newDay = result.find((d) => d.date === recentDateStr);
      expect(newDay).toBeDefined();
      expect(newDay?.count).toBe(1);
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

      let hasOldWeek: boolean;
      if (updatedCache) {
        hasOldWeek =
          updatedCache.permanentWeeks instanceof Map
            ? updatedCache.permanentWeeks.has(weekIdToDelete)
            : weekIdToDelete in updatedCache.permanentWeeks;
      } else {
        hasOldWeek = false;
      }

      expect(hasOldWeek).toBe(false);
      expect(result.length).toBe(365);
      expect(oldDay).toBeUndefined();
      expect(newDay).toBeDefined();
    });

    it('should freeze weeks between start of the graph until last week', async () => {
      const userId = createMockId();

      const today = new Date();

      // Date one week ago to be frozen
      const recentDate = new Date(today);
      recentDate.setUTCDate(recentDate.getUTCDate() - 7);
      const recentDateStr = formatDateKey(recentDate);

      const weekIdToFreeze = getISOWeekId(recentDate);

      // Date at least one week older than the week to be frozen
      const lastUpdatedDate = new Date(today);
      lastUpdatedDate.setUTCDate(lastUpdatedDate.getUTCDate() - 20);
      const lastUpdatedDateStr = formatDateKey(lastUpdatedDate);

      const currentWeekIdToFreeze = getISOWeekId(lastUpdatedDate);

      await Activity.create([
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date(recentDateStr),
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date(lastUpdatedDateStr),
        },
      ]);

      await ContributionCache.create({
        userId,
        lastUpdated: new Date(lastUpdatedDateStr),
        currentWeekData: [{ date: lastUpdatedDateStr, count: 1 }],
        permanentWeeks: {},
      });

      const result = await cacheManager.getUpdatedCache(userId);
      const frozenCurrentWeekDate = result.find(
        (d) => d.date === lastUpdatedDateStr,
      );
      const frozenOldWeekDate = result.find((d) => d.date === recentDateStr);

      const updatedCache = await ContributionCache.findOne({ userId });

      let hasFrozenOldWeek: boolean;
      if (updatedCache) {
        hasFrozenOldWeek =
          updatedCache.permanentWeeks instanceof Map
            ? updatedCache.permanentWeeks.has(weekIdToFreeze)
            : weekIdToFreeze in updatedCache.permanentWeeks;
      } else {
        hasFrozenOldWeek = false;
      }

      let hasFrozenCurrentWeek: boolean;
      if (updatedCache) {
        hasFrozenCurrentWeek =
          updatedCache.permanentWeeks instanceof Map
            ? updatedCache.permanentWeeks.has(currentWeekIdToFreeze)
            : currentWeekIdToFreeze in updatedCache.permanentWeeks;
      } else {
        hasFrozenCurrentWeek = false;
      }

      expect(hasFrozenOldWeek).toBe(true);
      expect(hasFrozenCurrentWeek).toBe(true);

      expect(frozenOldWeekDate).toBeDefined();
      expect(frozenOldWeekDate?.count).toBe(1);

      expect(frozenCurrentWeekDate).toBeDefined();
      expect(frozenCurrentWeekDate?.count).toBe(1);
    });
  });
});
