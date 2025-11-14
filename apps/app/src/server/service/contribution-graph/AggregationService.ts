import type { PipelineStage, Aggregate } from 'mongoose';

import { ActivityLogActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';


interface PipelineParams {
  userId: string;
  startDate: Date;
}

export class ContributionAggregationService {

  public runAggregationPipeline(params: PipelineParams): Aggregate<any[]> {
    const pipeline = this.buildPipeline(params);
    const activityResults = Activity.aggregate(pipeline);

    return activityResults;
  }

  private buildPipeline(params: PipelineParams): PipelineStage[] {
    const { userId, startDate } = params;

    const pipeline: PipelineStage[] = [
      {
        // 1. Find actions for a user, with certain actions and date
        $match: {
          userId,
          action: { $in: Object.values(ActivityLogActions) },
          timestamp: {
            $gte: startDate,
            $lt: new Date(),
          },
        },
      },

      // 2. Convert precise timestamp to a simple YYYY-MM-DD date string
      {
        $project: {
          _id: 0,
          date_key: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$timestamp',
              timezone: 'Z',
            },
          },
        },
      },

      // 3. Count the activities for each unique date
      {
        $group: {
          _id: '$date_key',
          count: { $sum: 1 },
        },
      },

      // 4. Format the output into the minified { "d": "...", "c": X } structure
      {
        $project: {
          _id: 0,
          d: '$_id',
          c: '$count',
        },
      },

      // 5. Ensure the results are in chronological order
      {
        $sort: {
          d: 1,
        },
      },
    ];

    return pipeline;
  }

}
