// match
//   for a certain user
//   within a specified period (since lastUpdate)

// activities from lastUpdated until now
// in minified JSON format, {"d":"", "c": "X"}

// Find user contrubution cache document
// Check when it was updated
// If it was not updated within 24 hours it checks the existing saved key values and current week
// Makes all weeks until this week permanent cache
// Gets current weeks data

// Aggregation only runs if cache miss
// Returns all daily count for all activity since lastUpdated


import type { PipelineStage } from 'mongoose';

import { ActivityLogActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';


interface PipelineParams {
  userId: string;
  startDate: Date;
}

export class ContributionAggregationService {

  public runAggregationPipeline(params: PipelineParams) {
    const pipeline = this.buildPipeline(params);
    const activityResults = Activity.aggregate(pipeline);

    return activityResults;
  }

  private buildPipeline(params: PipelineParams): PipelineStage[] {
    const { userId, startDate } = params;

    const pipeline: PipelineStage[] = [
      {
        $match: {
          userId,
          timestamp: {
            $gte: startDate,
            $lt: new Date(),
          },
          // action: 'relevant_contribution_action',
        },
      },

      // 2. Convert precise timestamp to a simple YYYY-MM-DD date string
      {
        $project: {
          _id: 0, // Exclude the original _id
          // Format the timestamp into a string key for accurate daily grouping
          date_key: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$timestamp',
              // Assuming timestamps are stored in UTC
              timezone: 'Z',
            },
          },
        },
      },

      // 3. Count the activities for each unique date
      {
        $group: {
          _id: '$date_key', // Group by the "YYYY-MM-DD" string
          count: { $sum: 1 }, // Sum up the documents (contributions) in each group
        },
      },

      // 4. Format the output into the minified { "d": "...", "c": X } structure
      {
        $project: {
          _id: 0, // Exclude the grouping _id
          d: '$_id', // Map the date string to 'd'
          c: '$count', // Map the count to 'c'
        },
      },

      // 5. Ensure the results are in chronological order
      {
        $sort: {
          d: 1, // Sort by date ascending (oldest first)
        },
      },
    ];

    return pipeline;
  }

}
