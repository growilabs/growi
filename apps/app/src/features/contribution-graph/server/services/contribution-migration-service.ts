import type { IUser } from '@growi/core';
import mongoose from 'mongoose';

import Activity from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';

import type { IMigratableUser } from '../../interfaces/contribution-migration';
import Contribution from '../models/contribution-model';
import { getContributionActivities } from './activity-aggregation-service';

/**
 * Creates Contribution documents based on existing Activity documents that counts as contributions for a user.
 */
export const migrateContributions = async (userId: string): Promise<void> => {
  if (userId == null || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error(
      'User ID invalid: Could not perform contribution migration',
    );
  }

  const activityExpirySeconds =
    configManager.getConfig('app:activityExpirationSeconds') ?? 2592000;
  const startDate = new Date(Date.now() - activityExpirySeconds * 1000);
  const endDate = new Date();

  // Aggregate all Activity documents that counts as contributions
  const activities = await getContributionActivities({
    userId,
    startDate,
    endDate,
  });

  // Using $set instead of $inc to make sure the count stays consistent in case
  // the migration script runs more than one time.
  if (activities.length > 0) {
    await Contribution.bulkWrite(
      activities.map((c) => ({
        updateOne: {
          filter: { user: userId, date: c.date },
          update: { $set: { count: c.count } },
          upsert: true,
        },
      })),
    );
  }
};

/**
 * Checks if a user's contributions have been migrated and migrates them if needed.
 */
export const ensureUserHasMigrated = async (
  user: IMigratableUser,
): Promise<void> => {
  // Fast path: skip the DB round-trip when the caller already knows it's migrated.
  if (user.contributionsMigratedAt != null) {
    return;
  }

  const User = mongoose.model<IUser>('User');

  const claimed = await User.findOneAndUpdate(
    { _id: user._id, contributionsMigratedAt: null },
    { $set: { contributionsMigratedAt: new Date() } },
  );
  // Migration is already in progress.
  if (claimed == null) {
    return;
  }

  try {
    await migrateContributions(user._id.toString());
  } catch (err) {
    // Release the claim so a later trigger can retry the migration.
    await User.updateOne(
      { _id: user._id },
      { $set: { contributionsMigratedAt: null } },
    );
    throw err;
  }
};

export const resolveContributor = async (
  activityId: string,
  contributor?: IMigratableUser | null,
): Promise<IMigratableUser | null> => {
  if (contributor?._id != null) {
    return contributor;
  }

  const activity = await Activity.findById(activityId).select('user');
  if (activity?.user == null) {
    return null;
  }

  return await mongoose.model<IUser>('User').findById(activity.user);
};
