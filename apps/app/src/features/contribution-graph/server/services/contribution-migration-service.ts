import mongoose from 'mongoose';

import { configManager } from '~/server/service/config-manager';

import Contribution from '../models/contribution-model';
import { ContributionAggregationService } from './aggregation-service';

const contributionAggregationService = new ContributionAggregationService();

/**
 * Migrates Activity documents that counts as contribution into Contribution documents.
 */
export const migrateContributions = async (userId: string) => {
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
  const activities =
    await contributionAggregationService.runAggregationPipeline({
      userId,
      startDate,
      endDate,
    });

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
