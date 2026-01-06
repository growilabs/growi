import type { PipelineStage, Aggregate } from 'mongoose';

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
          userId,
          action: { $in: Object.values(ActivityLogActions) },
          timestamp: { $gte: startDate, $lt: endDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: 'Z' },
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          d: '$_id',
          c: '$count',
        },
      },
      { $sort: { d: 1 } },
    ];
  }

}
