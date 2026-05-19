import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { configManager } from '~/server/service/config-manager';

import Contribution from '../models/contribution-model';
import { ActivityAggregationService } from './activity-aggregation-service';

const activityAggregationService = new ActivityAggregationService();

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
  const contributions = await activityAggregationService.runAggregationPipeline(
    {
      userId,
      startDate,
      endDate,
    },
  );

  if (contributions.length > 0) {
    await Contribution.bulkWrite(
      contributions.map((c) => ({
        updateOne: {
          filter: { user: userId, date: c.date },
          update: { $set: { count: c.count } },
          upsert: true,
        },
      })),
    );
  }
};

export const ensureUserHasMigrated = async (
  user: IUserHasId,
): Promise<string> => {
  if (user.contributionsMigratedAt != null) {
    return user._id.toString();
  } else {
    const User = mongoose.model('User');
    const freshUser = await User.findById(user._id);

    if (freshUser == null) {
      throw new Error(
        `Failed to update migration timestamp for user ${user._id}`,
      );
    } else if (freshUser.contributionsMigratedAt != null) {
      user.contributionsMigratedAt = freshUser.contributionsMigratedAt;
      return freshUser._id.toString();
    } else {
      await migrateContributions(freshUser._id.toString());

      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id },
        { contributionsMigratedAt: new Date() },
        { new: true },
      );

      if (updatedUser != null) {
        user.contributionsMigratedAt = updatedUser.contributionsMigratedAt;
      }

      return updatedUser._id.toString();
    }
  }
};
