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

    const pipeline: PipelineStage[] = [
      {
        // 1. Find actions for a user, with certain actions and date
        $match: {
          userId,
          action: { $in: Object.values(ActivityLogActions) },
          timestamp: {
            $gte: startDate,
            $lt: endDate,
          },
        },
      },

      // 2. Group activities by day
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$timestamp',
              unit: 'day',
              timezone: 'Z',
            },
          },
          count: { $sum: 1 },
        },
      },

      // 3. Project the result into the minified format for caching
      {
        $project: {
          _id: 0,
          d: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$_id',
              timezone: 'Z',
            },
          },
        },
      },

      // 4. Ensure the results are in chronological order
      {
        $sort: {
          d: 1,
        },
      },
    ];

    return pipeline;
  }

}
