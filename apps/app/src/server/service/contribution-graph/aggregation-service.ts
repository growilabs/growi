import type { PipelineStage, Aggregate } from 'mongoose';
import mongoose from 'mongoose';

import { getUTCMidnightToday } from '~/features/contribution-graph/utils/contribution-graph-utils';
import { ActivityLogActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';


export interface PipelineParams {
  userId: string;
  startDate: Date;
}

export class ContributionAggregationService {

  public runAggregationPipeline(params: PipelineParams): Aggregate<any[]> {
    const pipeline = this.buildPipeline(params);
    const activityResults = Activity.aggregate(pipeline);

    return activityResults;
  }

  public buildPipeline(params: PipelineParams): PipelineStage[] {
    const { userId, startDate } = params;
    const endDate = getUTCMidnightToday();

    return [
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          action: { $in: Object.values(ActivityLogActions) },
          createdAt: { $gte: startDate, $lt: endDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          count: '$count',
        },
      },
      { $sort: { date: 1 } },
    ];
  }

}
