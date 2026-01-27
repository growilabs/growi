import type { UpdateQuery } from 'mongoose';

import type { IContributionDay } from '~/interfaces/contribution-graph';

import {
  ContributionCache,
  type ContributionGraphDocument,
} from './models/contribution-cache-model';
import { getUTCMidnightToday } from './utils/contribution-graph-utils';

interface SetContributionCachePayload {
  userId: string;
  newCurrentWeek: IContributionDay[];
  weekToFreeze?: { id: string; data: IContributionDay[] };
  weekIdToDelete?: string;
}

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

/**
 * Updates and rotates the cache
 *
 * @returns - Updated cache.
 */
export async function updateContributionCache(
  setContributionCachePayload: SetContributionCachePayload,
): Promise<ContributionGraphDocument | null> {
  try {
    const { userId, newCurrentWeek, weekToFreeze, weekIdToDelete } =
      setContributionCachePayload;

    if (!userId || !newCurrentWeek) {
      throw new Error(
        'UserId and new contribution cache are required to update contribution cache',
      );
    }

    const updateQuery: UpdateQuery<ContributionGraphDocument> = {
      $set: {
        currentWeekData: newCurrentWeek,
        lastUpdated: new Date(),
      },
    };

    if (weekToFreeze && updateQuery.$set) {
      updateQuery.$set[`permanentWeeks.${weekToFreeze.id}`] = weekToFreeze.data;
    }

    const deleteQuery = weekIdToDelete
      ? { [`permanentWeeks.${weekIdToDelete}`]: '' }
      : {};

    const updatedCache = await ContributionCache.findOneAndUpdate(
      { userId },
      {
        ...updateQuery,
        ...(weekIdToDelete && { $unset: deleteQuery }),
      },
      {
        new: true,
        upsert: true,
      },
    ).exec();

    return updatedCache;
  } catch {
    throw new Error('Internal Server Error: Could not set contribution cache.');
  }
}
