import type { UpdateQuery } from 'mongoose';
import mongoose from 'mongoose';

import type { IContributionDay } from '~/features/contribution-graph/interfaces/contribution-graph';

import {
  ContributionCache,
  type ContributionGraphDocument,
} from '../models/contribution-cache-model';
import { getUTCMidnightToday } from '../utils/contribution-graph-utils';

export interface SetContributionCachePayload {
  userId: string;
  newCurrentWeek: IContributionDay[];
  weeksToFreeze?: { id: string; data: IContributionDay[] }[];
  weekIdsToDelete?: string[];
}

type SetFields = IContributionDay[] | Date;

export async function getContributionCache(
  userId: string,
): Promise<ContributionGraphDocument | null> {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return null;
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

/**
 * Checks if cache is newer than 00:00 today.
 */
export function cacheIsFresh(lastUpdated: Date | string | number): boolean {
  if (!lastUpdated) return false;

  const lastUpdatedDate = new Date(lastUpdated).getTime();
  const todaysDate = getUTCMidnightToday().getTime();

  return lastUpdatedDate >= todaysDate;
}

/**
 * Updates and rotates the contribution cache
 *
 * @returns - Updated cache.
 */
export async function updateContributionCache(
  setContributionCachePayload: SetContributionCachePayload,
): Promise<ContributionGraphDocument | null> {
  try {
    const { userId, newCurrentWeek, weeksToFreeze, weekIdsToDelete } =
      setContributionCachePayload;

    if (!userId || !newCurrentWeek) {
      throw new Error(
        'UserId and current week data are required when updating contribution cache.',
      );
    }

    const $set: Record<string, SetFields> = {
      currentWeekData: newCurrentWeek,
      lastUpdated: new Date(),
    };

    const $unset: Record<string, string> = {};

    if (weeksToFreeze && weeksToFreeze.length > 0) {
      for (const week of weeksToFreeze) {
        $set[`permanentWeeks.${week.id}`] = week.data;
      }
    }

    if (weekIdsToDelete && weekIdsToDelete.length > 0) {
      for (const id of weekIdsToDelete) {
        $unset[`permanentWeeks.${id}`] = '';
      }
    }

    const updateQuery: UpdateQuery<ContributionGraphDocument> = { $set };

    if (Object.keys($unset).length > 0) {
      updateQuery.$unset = $unset;
    }

    const updatedCache = await ContributionCache.findOneAndUpdate(
      { userId },
      updateQuery,
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
