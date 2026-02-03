import type {
  IContributionDay,
  IWeeksToFreeze,
  SetContributionCachePayload,
} from '../interfaces/contribution-graph';
import {
  formatDateKey,
  getCurrentWeekStart,
  getCutoffWeekId,
  getExpiredWeekIds,
  getISOWeekId,
  getStartDateFromISOWeek,
} from '../utils/contribution-graph-utils';
import {
  ContributionAggregationService,
  type PipelineParams,
} from './aggregation-service';
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

  public async getCache(userId: string) {
    const contributionCache = await getContributionCache(userId);

    if (!contributionCache?.lastUpdated) {
      throw new Error('Cache not found.');
    }

    const { lastUpdated, currentWeekData, permanentWeeks } = contributionCache;
    const cacheHit = cacheIsFresh(lastUpdated);

    if (cacheHit) {
      const permanentWeeksArray = Object.values(permanentWeeks);
      const combinedCacheData = [...permanentWeeksArray, ...currentWeekData];

      return combinedCacheData;
    } else {
      // what if only current week data is needed?

      const params: PipelineParams = {
        userId,
        startDate: lastUpdated,
      };

      const freshCacheData =
        await this.aggregationService.runAggregationPipeline(params);

      const currentWeekStart = getCurrentWeekStart();
      const newCurrentWeek: IContributionDay[] = [];

      const weeksToFreezeMap: Record<string, IContributionDay[]> = {};

      for (const contribution of freshCacheData) {
        if (contribution.date >= currentWeekStart) {
          newCurrentWeek.push(contribution);
        } else {
          const weekId = getISOWeekId(new Date(contribution.date));
          if (!weeksToFreezeMap[weekId]) {
            weeksToFreezeMap[weekId] = [];
          }
          weeksToFreezeMap[weekId].push(contribution);
        }
      }

      // weeks to freeze
      const weeksToFreeze: IWeeksToFreeze[] = Object.entries(
        weeksToFreezeMap,
      ).map(([id, data]) => ({
        id,
        data: this.fillGapsInWeek(getStartDateFromISOWeek(id), data),
      }));

      // weeks to delete
      const existingCache = await getContributionCache(userId);
      const cutoffWeekId = getCutoffWeekId(52);

      const weekIdsToDelete = existingCache
        ? getExpiredWeekIds(existingCache.permanentWeeks, cutoffWeekId)
        : [];

      const setContributionCachePayload: SetContributionCachePayload = {
        userId,
        newCurrentWeek,
        weeksToFreeze,
        weekIdsToDelete,
      };

      const updatedContributionCache = await updateContributionCache(
        setContributionCachePayload,
      );
    }
  }

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
