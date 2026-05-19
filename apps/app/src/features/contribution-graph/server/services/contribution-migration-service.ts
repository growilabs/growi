import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { configManager } from '~/server/service/config-manager';

import type { IActivityAggregationService } from '../../interfaces/activity-aggregation-service';
import type { IContributionMigrationService } from '../../interfaces/contribution-migration-service';
import Contribution from '../models/contribution-model';

export class ContributionMigrationService
  implements IContributionMigrationService
{
  constructor(
    private activityAggregationService: IActivityAggregationService,
  ) {}

  async migrateContributions(userId: string): Promise<void> {
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
    const contributions =
      await this.activityAggregationService.runAggregationPipeline({
        userId,
        startDate,
        endDate,
      });

    await Contribution.bulkWrite(
      contributions.map((c) => ({
        updateOne: {
          filter: { user: userId, date: c.date },
          update: { $inc: { count: c.count } },
          upsert: true,
        },
      })),
    );
  }

  async ensureUserHasMigrated(user: IUserHasId): Promise<string> {
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
        await this.migrateContributions(freshUser._id.toString());

        const updatedUser = await User.findOneAndUpdate(
          { _id: user._id },
          { contributionsMigratedAt: new Date() },
          { new: true },
        );

        user.contributionsMigratedAt = updatedUser.contributionsMigratedAt;

        return updatedUser._id.toString();
      }
    }
  }
}
