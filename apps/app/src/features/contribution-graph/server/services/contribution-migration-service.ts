import { configManager } from '~/server/service/config-manager';

import type { IContribution } from '../../interfaces/contribution';
import Contribution from '../models/contribution-model';
import { ContributionAggregationService } from './aggregation-service';

const contributionAggregationService = new ContributionAggregationService();

/**
 * Migrates Activity documents that counts as contribution into Contribution documents.
 */
export const migrateContributions = async (userId: string) => {
  if (userId == null) {
    throw new Error(
      'User ID invalid: Could not perform contribution migration',
    );
  }

  const activityExpirySeconds =
    configManager.getConfig('app:activityExpirationSeconds') ?? 2592000;
  const startDate = new Date(Date.now() - activityExpirySeconds * 1000);

  // Aggregate all Activity documents that counts as contributions
  const activityContributions =
    await contributionAggregationService.runAggregationPipeline({
      userId,
      startDate,
    });

  const contributions: IContribution[] = activityContributions.map(
    (activity) => ({
      user: userId,
      date: new Date(activity.date),
      count: activity.count,
    }),
  );

  await Contribution.insertMany(contributions);
};
