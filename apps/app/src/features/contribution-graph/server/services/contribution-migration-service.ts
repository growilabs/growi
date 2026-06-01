import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { configManager } from '~/server/service/config-manager';

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
 * Checks if a user's contributions has been migrated and migrates them if needed.
 */
export const ensureUserHasMigrated = async (
  user: IUserHasId,
): Promise<void> => {
  if (user?._id == null) {
    throw new Error('ensureUserHasMigrated requires a populated user document');
  }

  if (user.contributionsMigratedAt != null) {
    return;
  }

  const User = mongoose.model('User');

  // Checking current DB state in case received user object is stale
  const freshUser = await User.findById(user._id);
  if (freshUser == null) {
    throw new Error(`User ${user._id} was not found`);
  }
  if (freshUser.contributionsMigratedAt != null) {
    return;
  }

  await migrateContributions(freshUser._id.toString());

  await User.updateOne(
    { _id: user._id, contributionsMigratedAt: { $exists: false } },
    { $set: { contributionsMigratedAt: new Date() } },
  );
};
