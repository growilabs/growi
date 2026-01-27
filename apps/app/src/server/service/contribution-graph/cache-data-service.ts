import {
  ContributionCache,
  type ContributionGraphDocument,
} from './models/contribution-cache-model';
import { getUTCMidnightToday } from './utils/contribution-graph-utils';

export async function getContributionCache(
  userId: string,
): Promise<ContributionGraphDocument | null> {
  try {
    if (!userId) {
      throw new Error('UserId is required to fetch contribution cache');
    }

    const contributionCache = await ContributionCache.findOne({
      userId,
    }).exec();

    return contributionCache;
  } catch {
    throw new Error(
      'Internal Server Error: Could not retrieve contribution data',
    );
  }
}

export function cacheIsFresh(cache: ContributionGraphDocument | null): boolean {
  if (!cache || !cache.lastUpdated) return false;

  const lastUpdatedDate = new Date(cache.lastUpdated);
  const todaysDate = getUTCMidnightToday();

  return lastUpdatedDate >= todaysDate;
}

export async function setContributionCache(
  userId: string,
  cache: ContributionGraphDocument,
): Promise<ContributionGraphDocument | null> {
  try {
    if (!userId || !cache) {
      throw new Error(
        'UserId and new contribution cache are required to update contribution cache',
      );
    }

    const updatedCache = await ContributionCache.findOneAndUpdate(
      { userId },
      {
        $set: {
          currentWeekData: cache.currentWeekData,
          permanentWeeks: cache.permanentWeeks,
          lastUpdated: cache.lastUpdated,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      },
    ).exec();

    return updatedCache;
  } catch {
    throw new Error('Internal Server Error: Could not set contribution cache.');
  }
}

export async function rotatePermanentWeeks(
  userId: string,
  oldestWeekId: string,
): Promise<ContributionGraphDocument | null> {
  const updatedCache = await ContributionCache.findOneAndUpdate(
    { userId },
    {
      $unset: {
        [`permanentWeeks.${oldestWeekId}`]: '',
      },
    },
    {
      new: true,
      runValidators: true,
    },
  ).exec();

  return updatedCache;
}
