import type {
  IContributionDay,
  IWeeksToFreeze,
} from '../interfaces/contribution-graph';
import type { ContributionGraphDocument } from '../models/contribution-cache-model';
import {
  formatDateKey,
  getCurrentWeekStart,
  getCutoffWeekId,
  getExpiredWeekIds,
  getISOWeekId,
  getStartDateFromISOWeek,
} from '../utils/contribution-graph-utils';
import { ContributionAggregationService } from './aggregation-service';
import {
  cacheIsFresh,
  getContributionCache,
  updateContributionCache,
} from './cache-data-service';

export class ContributionCacheManager {
  aggregationService: ContributionAggregationService;

  constructor() {
    this.aggregationService = new ContributionAggregationService();
  }

  /**
   * Updated and gets the latest contribution data until today.
   *
   * @param userId - ID of user to fetch cache for.
   * @returns - Full combined array of all contributions until today.
   */
  public async getUpdatedCache(userId: string) {
    const contributionCache = await getContributionCache(userId);

    const isFresh = contributionCache
      ? cacheIsFresh(contributionCache.lastUpdated)
      : false;

    if (isFresh && contributionCache) {
      return this.assembleFullGraph(contributionCache);
    }

    let aggregationStartDate: Date;
    if (contributionCache) {
      aggregationStartDate = contributionCache.lastUpdated;
    } else {
      aggregationStartDate = new Date();
      aggregationStartDate.setUTCFullYear(
        aggregationStartDate.getUTCFullYear() - 1,
      );
    }

    const freshCacheData = await this.aggregationService.runAggregationPipeline(
      {
        userId,
        startDate: aggregationStartDate,
      },
    );

    const currentWeekStart = getCurrentWeekStart();
    const currentWeekStartStr = formatDateKey(currentWeekStart);

    const mergedCurrentWeekSparse = contributionCache
      ? [...contributionCache.currentWeekData]
      : [];
    const weeksToFreezeMap: Record<string, IContributionDay[]> = {};

    for (const contribution of freshCacheData) {
      if (contribution.date >= currentWeekStartStr) {
        const existingDay = mergedCurrentWeekSparse.find(
          (d) => d.date === contribution.date,
        );

        // add to count if the day exists
        if (existingDay) {
          existingDay.count = contribution.count;
        } else {
          mergedCurrentWeekSparse.push(contribution);
        }
      } else {
        const weekId = getISOWeekId(new Date(contribution.date));

        if (!weeksToFreezeMap[weekId]) {
          weeksToFreezeMap[weekId] = [];
        }
        weeksToFreezeMap[weekId].push(contribution);
      }
    }

    const finalizedCurrentWeek = this.fillGapsInWeek(
      currentWeekStart,
      mergedCurrentWeekSparse,
    );

    const weeksToFreeze: IWeeksToFreeze[] = Object.entries(
      weeksToFreezeMap,
    ).map(([id, data]) => ({
      id,
      data: this.fillGapsInWeek(getStartDateFromISOWeek(id), data),
    }));

    const cutoffWeekId = getCutoffWeekId(52);

    const weekIdsToDelete = contributionCache
      ? getExpiredWeekIds(contributionCache.permanentWeeks, cutoffWeekId)
      : [];

    const updatedCache = await updateContributionCache({
      userId,
      newCurrentWeek: finalizedCurrentWeek,
      weeksToFreeze,
      weekIdsToDelete,
    });

    if (!updatedCache) {
      throw new Error('Failed to update cache');
    }

    return this.assembleFullGraph(updatedCache);
  }

  /**
   * Takes updated cache and returns an array of all cache data.
   *
   * @param contributionCache - Updated cache to be displayed.
   * @returns - Array of contribution data until today.
   */
  private assembleFullGraph(
    contributionCache: ContributionGraphDocument,
  ): IContributionDay[] {
    const { currentWeekData, permanentWeeks } = contributionCache;

    const sortedPermanentData = Array.from(permanentWeeks.keys())
      .sort()
      .flatMap((id) => {
        const weekData = permanentWeeks.get(id);
        return weekData ?? [];
      });

    const runner = new Date();
    runner.setUTCDate(runner.getUTCDate() - 364);

    const allCache = new Map();
    for (let i = 0; i < 365; i++) {
      const dateKey = formatDateKey(runner);
      allCache.set(dateKey, 0);

      runner.setUTCDate(runner.getUTCDate() - 1);
    }

    for (const cache of sortedPermanentData) {
      if (allCache.has(cache.date)) {
        allCache.set(cache.date, cache.count);
      }
    }

    for (const cache of currentWeekData) {
      if (allCache.has(cache.date)) {
        allCache.set(cache.date, cache.count);
      }
    }

    return Array.from(allCache.entries()).map(([date, count]) => ({
      date,
      count,
    }));
  }

  /**
   * Fills in days which has no contribution with contributions that has 0 count.
   *
   * @param startDate - Day from where to start filling gaps.
   * @param dataToFill - Sparse array of contributions.
   * @returns - Full week of contributions.
   */
  private fillGapsInWeek(
    startDate: Date,
    dataToFill: IContributionDay[],
  ): IContributionDay[] {
    const contributionMap = new Map(dataToFill.map((c) => [c.date, c.count]));
    const filledWeek: IContributionDay[] = [];

    const weekStart = getCurrentWeekStart(startDate);
    const dayOfTheWeek = new Date(weekStart);

    for (let i = 0; i < 7; i++) {
      const dayOfTheWeekString = formatDateKey(dayOfTheWeek);

      const contribution: IContributionDay = {
        date: dayOfTheWeekString,
        count: contributionMap.get(dayOfTheWeekString) || 0,
      };
      filledWeek.push(contribution);

      dayOfTheWeek.setUTCDate(dayOfTheWeek.getUTCDate() + 1);
    }

    return filledWeek;
  }
}
