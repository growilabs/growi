import type { Aggregate, PipelineStage } from 'mongoose';
import mongoose from 'mongoose';

import Activity from '~/server/models/activity';

import type { IContributionDay } from '../../interfaces/contribution';
import { ContributionGraphActions } from '../../interfaces/supported-actions';

export interface PipelineParams {
  userId: string;
  startDate: Date;
  endDate: Date;
}

export const getContributionActivities = (
  params: PipelineParams,
): Aggregate<IContributionDay[]> => {
  const pipeline = buildPipeline(params);
  const activityContributions = Activity.aggregate(pipeline);

  return activityContributions;
};

const buildPipeline = (params: PipelineParams): PipelineStage[] => {
  const { userId, startDate, endDate } = params;

  return [
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        action: { $in: Object.values(ContributionGraphActions) },
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: {
          $dateTrunc: {
            date: '$createdAt',
            unit: 'day',
            timezone: 'UTC',
          },
        },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        date: { $dateToString: { format: '%Y-%m-%d', date: '$_id' } },
        count: '$count',
      },
    },
    { $sort: { date: 1 } },
  ];
};
