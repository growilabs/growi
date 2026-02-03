import type {
  IContributionDay,
  IWeeksToFreeze,
  SetContributionCachePayload,
} from '../interfaces/contribution-graph';
import {
  formatDateKey,
  getCurrentWeekStart,
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
      const setContributionCachePayload: SetContributionCachePayload = {
        userId,
        newCurrentWeek: currentWeekData,
      };

      const updatedContributionCache = await updateContributionCache(
        setContributionCachePayload,
      );
      const updatedCurrentWeek = updatedContributionCache?.currentWeekData;

      if (!updatedCurrentWeek) {
        throw new Error('Could not get updated current week cache');
      }

      const permanentWeeksArray = Object.values(permanentWeeks);
      const combinedCacheData = [...permanentWeeksArray, ...updatedCurrentWeek];

      return combinedCacheData;
    } else {
      const params: PipelineParams = {
        userId,
        startDate: lastUpdated,
      };

      // array with fresh data
      /*

      [
        { "date": "2025-10-20", "count": 4 },
        { "date": "2025-10-21", "count": 12 },
        { "date": "2025-10-23", "count": 1 },
        { "date": "2025-10-24", "count": 7 }
      ]

      */

      const freshCacheData =
        await this.aggregationService.runAggregationPipeline(params);

      const currentWeekStart = getCurrentWeekStart();
      const updatedCurrentWeek: IContributionDay[] = [];

      const weeksToFreeze: IWeeksToFreeze[] = [];

      for (const contribution of freshCacheData) {
        // if current week
        if (contribution.date >= currentWeekStart) {
          // add to current week
          updatedCurrentWeek.push(contribution);
        } else {
          const weekId = getISOWeekId(new Date(contribution.date));
          // if weekId doesnt exist
          if (!weeksToFreeze[weekId]) {
            weeksToFreeze[weekId] = [];
          }
          // add contribution to permanent weekId
          weeksToFreeze[weekId].push(contribution);
        }
      }

      const fullCurrentWeek = this.fillGapsInWeek(
        currentWeekStart,
        updatedCurrentWeek,
      );

      for (const weekId of weeksToFreeze) {
        // You need a utility to get the Monday of a specific ISO Week ID
        const weekStartDate = getStartDateFromISOWeek(weekId.id);

        weeksToFreeze[weekId.id] = this.fillGapsInWeek(
          weekStartDate,
          weeksToFreeze[weekId.id],
        );
      }

      // check missing weeks
      // check missing

      // freeze weeks older than current week
      // combine permanent and current weeks
      // return combined weeks

      const setContributionCachePayload: SetContributionCachePayload = {
        userId,
        newCurrentWeek: currentWeekData,
        weeksToFreeze: [...weeksToFreeze],
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
