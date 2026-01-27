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
  } catch (_error) {
    throw new Error(
      'Internal Server Error: Could not retrieve contribution data',
    );
  }
}

export function cacheIsFresh(cache: ContributionGraphDocument | null): boolean {
  if (!cache || !cache.lastUpdated) return false;

  const lastUpdatedDate = new Date(cache.lastUpdated);
  const todaysDate = getUTCMidnightToday();

  if (lastUpdatedDate <= todaysDate) return false;

  return true;
}
