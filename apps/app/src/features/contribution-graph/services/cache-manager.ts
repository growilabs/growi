import type {
  IContributionDay,
  WeeksToFreeze,
} from '../interfaces/contribution-graph';
import {
  getCurrentWeekStart,
  getISOWeekId,
} from '../utils/contribution-graph-utils';
import {
  ContributionAggregationService,
  type PipelineParams,
} from './aggregation-service';
import {
  cacheIsFresh,
  getContributionCache,
  type SetContributionCachePayload,
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
      const weeksToFreeze: WeeksToFreeze = {
        permanentWeeks: {},
      };

      for (const contribution of freshCacheData) {
        // if current week
        if (contribution.date >= currentWeekStart) {
          // add to current week
          updatedCurrentWeek.push(contribution);
        } else {
          const weekId = getISOWeekId(new Date(contribution.date));
          // if weekId doesnt exist
          if (!weeksToFreeze.permanentWeeks[weekId]) {
            weeksToFreeze.permanentWeeks[weekId] = [];
          }
          // add contribution to permanent weekId
          weeksToFreeze.permanentWeeks[weekId].push(contribution);
        }
      }

      // method for filling gaps in current week
      const weekStartDate = getCurrentWeekStart(
        new Date(updatedCurrentWeek[0].date),
      );
      const weekId = getISOWeekId(new Date(updatedCurrentWeek[i].date));

      for (let i = 0; i <= 7; i++) {
        weekStartDate.setDate(weekStartDate.getDate() + i);
      }

      // I have one array with updated current weeks contribution and one for the permanent weeks to be added
      // Missing days?

      // array of dates
      // sort dates into week objects
      // fill in gaps

      // sort days into weeks
      // need method for filling in gaps of no contributions in week
      // freeze weeks older than current week
      // combine permanent and current weeks
      // return combined weeks

      const setContributionCachePayload: SetContributionCachePayload = {
        userId,
        newCurrentWeek: currentWeekData,
      };

      const updatedContributionCache = await updateContributionCache(
        setContributionCachePayload,
      );
    }
  }
}
