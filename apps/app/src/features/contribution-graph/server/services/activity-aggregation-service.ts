import { toRawDate, toRawObjectId } from '~/server/util/prisma-raw-normalize';
import { prisma } from '~/utils/prisma';

import type { IContributionDay } from '../../interfaces/contribution';
import { ContributionGraphActions } from '../../interfaces/supported-actions';
import { aggregateContributions } from './aggregate-contributions';

export interface PipelineParams {
  userId: string;
  startDate: Date;
  endDate: Date;
}

export const getContributionActivities = (
  params: PipelineParams,
): Promise<IContributionDay[]> => {
  const pipeline = buildPipeline(params);
  return aggregateContributions(prisma, pipeline);
};

export const buildPipeline = (
  params: PipelineParams,
): Record<string, unknown>[] => {
  const { userId, startDate, endDate } = params;

  return [
    {
      $match: {
        user: toRawObjectId(userId),
        action: { $in: Object.values(ContributionGraphActions) },
        createdAt: { $gte: toRawDate(startDate), $lte: toRawDate(endDate) },
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
